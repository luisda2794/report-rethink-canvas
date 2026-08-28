import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDireccionIncorrecta } from "@/lib/direccion-incorrecta";
import { isoAddDays, lastNBusinessDays } from "@/lib/business-days";
import { readCacheRange, writeCacheBatch } from "@/lib/hub-daily-cache";

// CD5 no tiene todavía un cálculo diario reutilizable en la base — las tres
// implementaciones existentes (paquetes_en_riesgo_stats, refresh_cd5_snapshots,
// y el "% CD5" de Clientes Locales) son cada una específica a su propia
// pantalla/fuente de datos, ninguna sirve tal cual para una tendencia diaria
// por hub. Se calcula acá con consultas directas a epod_lineas (mismo motivo
// que Mapa de Entregas y Facturación: una función Postgres nueva es una
// migración más que podría no llegar a producción — ver el historial de esta
// sesión) en vez de agregar un cuarto RPC.
//
// Definición final de CD5 (día evaluado D, ancla A = D - 5 días de calendario):
//
//   Cohorte de A = waybills con
//     (a) inbound === A (llegaron ese día), O
//     (b) inbound < A Y su último estado conocido con fecha <= A era
//         Driver_received/Driver_received_incidencias (ya venían atascados,
//         sin resolver, exactamente ese día — sin importar cuándo llegaron).
//
//   Evaluación en D = para cada waybill del cohorte, su último estado
//   conocido con fecha <= D: "Entregado" = resuelto a tiempo, cualquier otra
//   cosa (incluido seguir en Driver_received) = roto. Esta evaluación queda
//   congelada — no se corrige si el paquete se entrega después de D.
//
//   % CD5 = resueltos / cohorte × 100.
//
// "Último estado conocido con fecha <= X" es un corte histórico, no exige
// que exista una fila exacta ese día — así un paquete que no se re-sube
// todos los días igual arrastra su último estado real conocido.
//
// waybill puede venir NULL para un hub entero si el ePOD subido traía una
// variante de columna no cubierta por el parser (pasó con Luan Express:
// "Waybill Number" en vez de "Waybill No" — corregido en /epod, pero eso no
// arregla filas ya subidas). lp_no es NOT NULL por schema: se usa
// waybill || lp_no como identificador, nunca solo waybill.
//
// Se trae el historial completo del hub una sola vez (paginado en paralelo)
// y se reconstruyen los 20 cohortes en memoria, en vez de golpear la base
// una vez por día evaluado.

const STUCK_ESTADOS = new Set(["driver_received", "driver_received_incidencias"]);

function normalizeEstado(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "_");
}
function isStuckEstado(s: string): boolean {
  return STUCK_ESTADOS.has(normalizeEstado(s));
}
function isEntregado(s: string): boolean {
  const n = s.trim().toLowerCase();
  return n === "entregado" || n === "delivered";
}

function packageId(waybill: string | null, lpNo: string): string {
  return waybill || lpNo;
}

type Cd5Row = {
  waybill: string | null;
  lp_no: string;
  fecha: string | null;
  estado: string;
  exception_detail: string | null;
  row_index: number;
};

type Event = { wb: string; fecha: string; estado: string; rowIndex: number };
type Checkpoint = { fecha: string; kind: "anchor" | "eval"; trendDay: string };

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
        .select("waybill, lp_no, fecha, estado, exception_detail, row_index")
        .eq("hub_id", hubId)
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

// Span real de historial (MIN/MAX fecha) del hub — dos consultas baratas
// (usan idx_epod_lineas_hub_fecha). Hace falta cuando la tendencia viene
// 100% de caché (ver useCd5Trend): en ese camino no se leyó ninguna fila
// real, así que no hay de dónde sacar earliestFecha/latestFecha — y esos
// dos valores alimentan la detección de "historial insuficiente" en la UI,
// que es sobre los datos reales del hub, no sobre la ventana de 20 días
// pedida (que siempre "existe" una vez que todo quedó cacheado, tenga o no
// suficiente historial real detrás).
async function fetchHistorySpan(hubId: string): Promise<{ earliestFecha: string | null; latestFecha: string | null }> {
  const [{ data: minRow }, { data: maxRow }] = await Promise.all([
    supabase.from("epod_lineas").select("fecha").eq("hub_id", hubId).not("fecha", "is", null).order("fecha", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("epod_lineas").select("fecha").eq("hub_id", hubId).not("fecha", "is", null).order("fecha", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { earliestFecha: minRow?.fecha ?? null, latestFecha: maxRow?.fecha ?? null };
}

// Una sola pasada cronológica en vez de 20 (una por día de tendencia):
// se ordenan TODOS los eventos una vez, y se recorren linealmente
// manteniendo un "estado actual por paquete" que se va actualizando — en
// vez de reconstruirlo desde cero (con una búsqueda por paquete) 20 veces.
// Los 20 días de ancla y los 20 días evaluados (40 "puntos de lectura" en
// total, alguno puede coincidir) se intercalan como checkpoints en la misma
// línea de tiempo: al llegar a cada uno, el mapa de estado ya refleja
// exactamente lo que pasó hasta esa fecha inclusive — sin volver a mirar
// filas viejas. Los checkpoints de tipo "ancla" arman el cohorte de ese
// día (usando el mapa en ese momento) y lo guardan para leerlo 5 días
// después en el checkpoint "eval" correspondiente. Complejidad: ordenar
// todos los eventos (O(N log N)) + un barrido lineal con dos punteros — ya
// no son 20 recorridas independientes del historial completo.
function computeCd5Trend(rows: Cd5Row[], trendDays: string[]): Cd5TrendResult {
  let earliestFecha: string | null = null;
  let latestFecha: string | null = null;

  const events: Event[] = [];
  // Exclusión por Dirección Incorrecta: se calcula sobre la ÚLTIMA incidencia
  // de todo el historial del waybill (no solo hasta el día ancla), igual que
  // antes — por eso se resuelve aparte del barrido incremental.
  const lastException = new Map<string, { fecha: string; rowIndex: number; detail: string }>();

  for (const r of rows) {
    if (!r.fecha) continue;
    if (!earliestFecha || r.fecha < earliestFecha) earliestFecha = r.fecha;
    if (!latestFecha || r.fecha > latestFecha) latestFecha = r.fecha;

    const wb = packageId(r.waybill, r.lp_no);
    if (!wb) continue;

    events.push({ wb, fecha: r.fecha, estado: r.estado, rowIndex: r.row_index });

    const detail = (r.exception_detail ?? "").trim();
    if (detail) {
      const prev = lastException.get(wb);
      if (!prev || r.fecha > prev.fecha || (r.fecha === prev.fecha && r.row_index > prev.rowIndex)) {
        lastException.set(wb, { fecha: r.fecha, rowIndex: r.row_index, detail });
      }
    }
  }
  events.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.rowIndex - b.rowIndex));

  const excluded = new Set<string>();
  for (const [wb, exc] of lastException) {
    if (isDireccionIncorrecta(exc.detail)) excluded.add(wb);
  }

  const checkpoints: Checkpoint[] = [];
  for (const d of trendDays) {
    checkpoints.push({ fecha: isoAddDays(d, -5), kind: "anchor", trendDay: d });
    checkpoints.push({ fecha: d, kind: "eval", trendDay: d });
  }
  checkpoints.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  const estadoActual = new Map<string, string>();
  const inboundPorPaquete = new Map<string, string>();
  const cohortesPorDia = new Map<string, string[]>();
  const pointsPorDia = new Map<string, Cd5DayPoint>();

  let ei = 0;
  for (const cp of checkpoints) {
    // Aplica todos los eventos hasta esta fecha (inclusive) antes de leer el
    // estado — así el checkpoint ve exactamente "lo que pasó hasta ahí".
    while (ei < events.length && events[ei].fecha <= cp.fecha) {
      const e = events[ei];
      estadoActual.set(e.wb, e.estado);
      if (!inboundPorPaquete.has(e.wb)) inboundPorPaquete.set(e.wb, e.fecha); // primera vez visto = el más antiguo (eventos ya en orden)
      ei++;
    }

    if (cp.kind === "anchor") {
      const cohorte: string[] = [];
      for (const [wb, inbound] of inboundPorPaquete) {
        if (excluded.has(wb)) continue;
        if (inbound === cp.fecha) {
          cohorte.push(wb); // llegó justo el día ancla
        } else if (inbound < cp.fecha) {
          const estado = estadoActual.get(wb);
          if (estado && isStuckEstado(estado)) cohorte.push(wb); // seguía atascado ese día
        }
      }
      cohortesPorDia.set(cp.trendDay, cohorte);
    } else {
      const cohorte = cohortesPorDia.get(cp.trendDay) ?? [];
      let resueltos = 0;
      for (const wb of cohorte) {
        const estado = estadoActual.get(wb);
        if (estado && isEntregado(estado)) resueltos++;
      }
      const total = cohorte.length;
      pointsPorDia.set(cp.trendDay, { fecha: cp.trendDay, total, resueltos, pct: total > 0 ? (resueltos / total) * 100 : null });
    }
  }

  const points = trendDays.map((d) => pointsPorDia.get(d)!);
  return { points, earliestFecha, latestFecha };
}

// Cálculo de un solo día (el que se acaba de subir) — lo usa el trigger de
// /epod después de cada subida, y el backfill masivo hace su propia versión
// en lote (ver backfillCd5Cache) en vez de llamar esto en loop, para no
// repetir 20+ veces un fetch de ventana casi idéntica.
export async function computeCd5ForDay(hubId: string, fecha: string): Promise<Cd5DayPoint> {
  const from = isoAddDays(fecha, -5 - LOOKBACK_BUFFER_DAYS);
  const rows = await fetchCd5Rows(hubId, from, fecha);
  const { points } = computeCd5Trend(rows, [fecha]);
  return points[0];
}

// Recalcula y cachea CD5 para un conjunto arbitrario de días en una sola
// pasada (un solo fetch + un solo barrido cronológico) — usado por el botón
// admin "Recalcular caché completa" para rellenar el histórico de hubs que
// ya tenían datos antes de esta capa de caché.
export async function backfillCd5Cache(hubId: string, allDates: string[]): Promise<void> {
  if (allDates.length === 0) return;
  const sorted = [...allDates].sort();
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  const from = isoAddDays(oldest, -5 - LOOKBACK_BUFFER_DAYS);
  const rows = await fetchCd5Rows(hubId, from, newest);
  const { points } = computeCd5Trend(rows, sorted);
  await writeCacheBatch(
    hubId,
    "cd5",
    points.map((p) => ({ fecha: p.fecha, datos: p })),
  );
}

export function useCd5Trend(hubId: string | null, businessDays: number) {
  return useQuery({
    queryKey: ["kpis-cd5-trend-v3", hubId, businessDays],
    enabled: !!hubId,
    queryFn: async (): Promise<Cd5TrendResult> => {
      if (!hubId) return { points: [], earliestFecha: null, latestFecha: null };
      const trendDays = lastNBusinessDays(businessDays);

      // Lectura con fallback: si la caché ya tiene los 20 días pedidos,
      // instantáneo. Si falta cualquiera, se recalcula en vivo la ventana
      // completa (como ya hacía antes de esta capa) y de paso se deja la
      // caché tibia — nunca es una dependencia dura, solo acelera.
      const cached = await readCacheRange<Cd5DayPoint>(hubId, "cd5", trendDays);
      if (trendDays.every((d) => cached.has(d))) {
        const span = await fetchHistorySpan(hubId);
        return {
          points: trendDays.map((d) => cached.get(d)!),
          earliestFecha: span.earliestFecha,
          latestFecha: span.latestFecha,
        };
      }

      const oldest = trendDays[0];
      const newest = trendDays[trendDays.length - 1];
      const from = isoAddDays(oldest, -5 - LOOKBACK_BUFFER_DAYS);
      const rows = await fetchCd5Rows(hubId, from, newest);
      const result = computeCd5Trend(rows, trendDays);
      void writeCacheBatch(
        hubId,
        "cd5",
        result.points.map((p) => ({ fecha: p.fecha, datos: p })),
      ).catch((e) => console.error("[kpis-cd5] Error escribiendo caché:", e));
      return result;
    },
    staleTime: 5 * 60 * 1000,
  });
}
