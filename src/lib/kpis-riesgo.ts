import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Pestaña "Paquetes en Riesgo" de /reportes (KPIs). Criterio (distinto del
// que ya usa /reportes/paquetes-en-riesgo, que solo mira antigüedad):
//   - Último estado conocido = Driver_received/Driver_received_incidencias.
//   - 3 o más intentos fallidos (estado = 'Attempt Failure') en todo su
//     historial.
//   - Inbound (MIN(fecha)) hace 5 días de calendario o más — misma lógica
//     de antigüedad que CD5.
// A propósito NO excluye "Dirección Incorrecta": el reporte original
// (paquetes_en_riesgo_stats) tampoco lo hace, así que se mantiene esa misma
// convención acá para no divergir entre los dos reportes de riesgo.
//
// Identificador robusto: waybill || lp_no (mismo fix que CD5 — waybill
// puede venir NULL para un hub entero si el ePOD traía una variante de
// columna no cubierta por el parser).

const STUCK_ESTADOS = new Set(["driver_received", "driver_received_incidencias"]);
const MIN_INTENTOS_FALLIDOS = 3;
const MIN_DIAS_INBOUND = 5;

function normalizeEstado(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "_");
}
function isStuckEstado(s: string): boolean {
  return STUCK_ESTADOS.has(normalizeEstado(s));
}
function isAttemptFailure(s: string): boolean {
  return s.trim().toLowerCase() === "attempt failure";
}
function packageId(waybill: string | null, lpNo: string): string {
  return waybill || lpNo;
}

type RiesgoRow = {
  waybill: string | null;
  lp_no: string;
  fecha: string | null;
  estado: string;
  exception_detail: string | null;
  cp: string | null;
  direccion: string | null;
  driver: string | null;
  row_index: number;
};

export type PaqueteEnRiesgo = {
  id: string;
  diasDesdeInbound: number;
  intentosFallidos: number;
  ultimaIncidencia: string;
  cp: string;
  direccion: string;
  driver: string;
};

export type RiesgoResult = {
  paquetes: PaqueteEnRiesgo[];
  /** Fecha usada como "hoy" para la evaluación — la más reciente con datos, no necesariamente el día de calendario real. */
  fechaEvaluada: string | null;
};

const PAGE_SIZE = 1000;
const LOOKBACK_DAYS = 180;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fetchRiesgoRows(hubId: string): Promise<RiesgoRow[]> {
  const from = isoDaysAgo(LOOKBACK_DAYS);
  const to = todayIso();
  const { count, error: countErr } = await supabase
    .from("epod_lineas")
    .select("id", { count: "exact", head: true })
    .eq("hub_id", hubId)
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
        .select("waybill, lp_no, fecha, estado, exception_detail, cp, direccion, driver, row_index")
        .eq("hub_id", hubId)
        .gte("fecha", from)
        .lte("fecha", to)
        .order("id", { ascending: true })
        .range(start, start + PAGE_SIZE - 1);
    }),
  );
  const all: RiesgoRow[] = [];
  for (const { data, error } of pages) {
    if (error) throw error;
    all.push(...((data ?? []) as RiesgoRow[]));
  }
  return all;
}

function computeRiesgo(rows: RiesgoRow[]): RiesgoResult {
  let fechaEvaluada: string | null = null;
  for (const r of rows) {
    if (r.fecha && (!fechaEvaluada || r.fecha > fechaEvaluada)) fechaEvaluada = r.fecha;
  }
  if (!fechaEvaluada) return { paquetes: [], fechaEvaluada: null };

  type Agg = {
    inbound: string;
    intentosFallidos: number;
    lastRow: RiesgoRow;
    lastException: { fecha: string; rowIndex: number; detail: string } | null;
  };
  const byId = new Map<string, Agg>();

  for (const r of rows) {
    if (!r.fecha) continue;
    const id = packageId(r.waybill, r.lp_no);
    if (!id) continue;

    let agg = byId.get(id);
    if (!agg) {
      agg = { inbound: r.fecha, intentosFallidos: 0, lastRow: r, lastException: null };
      byId.set(id, agg);
    }
    if (r.fecha < agg.inbound) agg.inbound = r.fecha;
    if (isAttemptFailure(r.estado)) agg.intentosFallidos++;
    if (r.fecha > agg.lastRow.fecha! || (r.fecha === agg.lastRow.fecha && r.row_index > agg.lastRow.row_index)) {
      agg.lastRow = r;
    }
    const detail = (r.exception_detail ?? "").trim();
    if (detail) {
      if (!agg.lastException || r.fecha > agg.lastException.fecha || (r.fecha === agg.lastException.fecha && r.row_index > agg.lastException.rowIndex)) {
        agg.lastException = { fecha: r.fecha, rowIndex: r.row_index, detail };
      }
    }
  }

  const paquetes: PaqueteEnRiesgo[] = [];
  for (const [id, agg] of byId) {
    if (!isStuckEstado(agg.lastRow.estado)) continue;
    if (agg.intentosFallidos < MIN_INTENTOS_FALLIDOS) continue;
    const dias = Math.round((Date.parse(fechaEvaluada) - Date.parse(agg.inbound)) / 86_400_000);
    if (dias < MIN_DIAS_INBOUND) continue;

    paquetes.push({
      id,
      diasDesdeInbound: dias,
      intentosFallidos: agg.intentosFallidos,
      ultimaIncidencia: agg.lastException?.detail ?? "Sin incidencias",
      cp: agg.lastRow.cp ?? "",
      direccion: agg.lastRow.direccion ?? "",
      driver: agg.lastRow.driver ?? "",
    });
  }
  paquetes.sort((a, b) => b.diasDesdeInbound - a.diasDesdeInbound);

  return { paquetes, fechaEvaluada };
}

export function useRiesgo(hubId: string | null) {
  return useQuery({
    queryKey: ["kpis-riesgo", hubId],
    enabled: !!hubId,
    queryFn: async (): Promise<RiesgoResult> => {
      if (!hubId) return { paquetes: [], fechaEvaluada: null };
      const rows = await fetchRiesgoRows(hubId);
      return computeRiesgo(rows);
    },
    staleTime: 5 * 60 * 1000,
  });
}
