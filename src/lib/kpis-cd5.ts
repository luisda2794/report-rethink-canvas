import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDireccionIncorrecta } from "@/lib/direccion-incorrecta";
import { isoAddDays, lastNBusinessDays } from "@/lib/business-days";

// CD5 no tiene todavía un cálculo diario reutilizable en la base — las tres
// implementaciones existentes (paquetes_en_riesgo_stats, refresh_cd5_snapshots,
// y el "% CD5" de Clientes Locales) son cada una específica a su propia
// pantalla/fuente de datos, ninguna sirve tal cual para una tendencia diaria
// por hub. Se calcula acá con consultas directas a epod_lineas (mismo motivo
// que Mapa de Entregas y Facturación: una función Postgres nueva es una
// migración más que podría no llegar a producción — ver el historial de esta
// sesión) en vez de agregar un cuarto RPC.
//
// Cohorte del día D = waybills cuyo inbound (MIN(fecha) en todo su historial)
// fue hace exactamente 5 días de calendario (D - 5), excluyendo los que
// tengan "Dirección Incorrecta" como última incidencia (misma regla que
// SHEIN CD4 / Locales CD5). % CD5 = (cohorte − siguen en reparto) / cohorte.
//
// Para que MIN(fecha) sea confiable (no un mínimo "recortado" por el rango
// que se pide a la base) se trae bastante más historial hacia atrás del que
// se necesita para el cohorte de cada día evaluado.

const STUCK_ESTADOS = new Set(["driver_received", "driver_received_incidencias"]);

type Cd5Row = {
  waybill: string | null;
  fecha: string | null;
  estado: string;
  exception_detail: string | null;
  row_index: number;
};

export type Cd5DayPoint = {
  fecha: string;
  total: number;
  resueltos: number;
  pct: number | null;
};

export type Cd5TrendResult = {
  points: Cd5DayPoint[];
  /** Span real de historial disponible para el hub (dentro de la ventana consultada). */
  earliestFecha: string | null;
  latestFecha: string | null;
};

const PAGE_SIZE = 1000;
const LOOKBACK_BUFFER_DAYS = 100;

async function fetchCd5Rows(hubId: string, from: string, to: string): Promise<Cd5Row[]> {
  const { count, error: countErr } = await supabase
    .from("epod_lineas")
    .select("id", { count: "exact", head: true })
    .eq("hub_id", hubId)
    .not("waybill", "is", null)
    .gte("fecha", from)
    .lte("fecha", to);
  if (countErr) throw countErr;

  const total = count ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => {
      const start = i * PAGE_SIZE;
      return supabase
        .from("epod_lineas")
        .select("waybill, fecha, estado, exception_detail, row_index")
        .eq("hub_id", hubId)
        .not("waybill", "is", null)
        .gte("fecha", from)
        .lte("fecha", to)
        .order("id", { ascending: true })
        .range(start, start + PAGE_SIZE - 1);
    }),
  );
  const all: Cd5Row[] = [];
  for (const { data, error } of pages) {
    if (error) throw error;
    all.push(...((data ?? []) as Cd5Row[]));
  }
  return all;
}

function computeCd5Trend(rows: Cd5Row[], trendDays: string[]): Cd5TrendResult {
  let earliestFecha: string | null = null;
  let latestFecha: string | null = null;
  for (const r of rows) {
    if (!r.fecha) continue;
    if (!earliestFecha || r.fecha < earliestFecha) earliestFecha = r.fecha;
    if (!latestFecha || r.fecha > latestFecha) latestFecha = r.fecha;
  }

  const minFecha = new Map<string, string>();
  const lastException = new Map<string, { fecha: string; rowIndex: number; detail: string }>();
  const estadoOn = new Map<string, { estado: string; rowIndex: number }>(); // `${waybill}|${fecha}`

  for (const r of rows) {
    const wb = r.waybill;
    const fecha = r.fecha;
    if (!wb || !fecha) continue;

    const prevMin = minFecha.get(wb);
    if (!prevMin || fecha < prevMin) minFecha.set(wb, fecha);

    const detail = (r.exception_detail ?? "").trim();
    if (detail) {
      const prev = lastException.get(wb);
      if (!prev || fecha > prev.fecha || (fecha === prev.fecha && r.row_index > prev.rowIndex)) {
        lastException.set(wb, { fecha, rowIndex: r.row_index, detail });
      }
    }

    const key = `${wb}|${fecha}`;
    const prevEstado = estadoOn.get(key);
    if (!prevEstado || r.row_index > prevEstado.rowIndex) {
      estadoOn.set(key, { estado: r.estado, rowIndex: r.row_index });
    }
  }

  // Waybills excluidos por Dirección Incorrecta, resuelto una sola vez.
  const excluded = new Set<string>();
  for (const [wb, exc] of lastException) {
    if (isDireccionIncorrecta(exc.detail)) excluded.add(wb);
  }

  const points = trendDays.map((fecha) => {
    const t0Target = isoAddDays(fecha, -5);
    let total = 0;
    let resueltos = 0;
    for (const [wb, t0] of minFecha) {
      if (t0 !== t0Target || excluded.has(wb)) continue;
      const onDay = estadoOn.get(`${wb}|${fecha}`);
      if (!onDay) continue; // el waybill no aparece en el ePOD de ese día — no evaluable
      total++;
      const norm = onDay.estado.trim().toLowerCase().replace(/\s+/g, "_");
      if (!STUCK_ESTADOS.has(norm)) resueltos++;
    }
    return { fecha, total, resueltos, pct: total > 0 ? (resueltos / total) * 100 : null };
  });

  return { points, earliestFecha, latestFecha };
}

export function useCd5Trend(hubId: string | null, businessDays: number) {
  return useQuery({
    queryKey: ["kpis-cd5-trend", hubId, businessDays],
    enabled: !!hubId,
    queryFn: async (): Promise<Cd5TrendResult> => {
      if (!hubId) return { points: [], earliestFecha: null, latestFecha: null };
      const trendDays = lastNBusinessDays(businessDays);
      const oldest = trendDays[0];
      const newest = trendDays[trendDays.length - 1];
      const from = isoAddDays(oldest, -5 - LOOKBACK_BUFFER_DAYS);
      const rows = await fetchCd5Rows(hubId, from, newest);
      return computeCd5Trend(rows, trendDays);
    },
    staleTime: 5 * 60 * 1000,
  });
}
