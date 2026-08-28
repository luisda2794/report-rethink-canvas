import { supabase } from "@/integrations/supabase/client";

// Lógica de cálculo de Flow Meeting, separada del componente de página
// (src/routes/flow-meeting.tsx) para poder reutilizarla desde el trigger de
// caché de /epod y desde el backfill masivo, sin duplicarla.

export type Categoria = "COMPLETADO" | "DEVOLUCION" | "EN_REPARTO" | "FALLO" | "OTRO";

export type RawRow = {
  waybill: string;
  fecha: Date | null;
  estado: string;
  categoria: Categoria;
  incidencia: string;
  cp: string;
  driver: string;
  tipoEntrega: string;
  mercado: string;
  vendedor: string;
  rowIndex: number;
};

export function dayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

export function categorizar(estadoRaw: string): Categoria {
  const s = estadoRaw.trim().toLowerCase();
  if (s === "entregado" || s === "delivered") return "COMPLETADO";
  if (s === "return_to_seller_success") return "DEVOLUCION";
  if (s === "driver_received" || s === "driver_received_incidencias") return "EN_REPARTO";
  if (s === "attempt failure" || s === "return_to_seller_fail") return "FALLO";
  return "OTRO";
}

export type DriverAgg = {
  driver: string;
  total: number;
  entregado: number;
  devolucion: number;
  enReparto: number;
  fallos: number;
  otros: number;
};

export type CpAgg = {
  driver: string;
  cp: string;
  total: number;
  completado: number;
  enReparto: number;
  fallos: number;
};

export type Analysis = {
  maxDate: Date | null;
  totalDia: number;
  completados: number;
  devoluciones: number;
  enReparto: number;
  fallos: number;
  otros: number;
  pctCompletado: number;
  pudoTotal: number;
  pudoEntregados: number;
  pudoPendientes: number;
  drivers: DriverAgg[];
  cps: CpAgg[];
  cpsCount: number;
  incidencias: Array<{ nombre: string; count: number }>;
};

// Versión de Analysis sin Date (jsonb no lo soporta) — lo que realmente se
// guarda en hub_daily_cache. maxDate se reconstruye al leer, a partir de la
// columna `fecha` de la fila de caché (ya la sabemos, no hace falta guardarla).
export type CachedAnalysis = Omit<Analysis, "maxDate">;

export function toCachedAnalysis(a: Analysis): CachedAnalysis {
  const { maxDate: _maxDate, ...rest } = a;
  return rest;
}

export function fromCachedAnalysis(cached: CachedAnalysis, fecha: string): Analysis {
  return { ...cached, maxDate: new Date(`${fecha}T00:00:00`) };
}

export function analyze(rows: RawRow[]): Analysis {
  const empty: Analysis = {
    maxDate: null,
    totalDia: 0,
    completados: 0,
    devoluciones: 0,
    enReparto: 0,
    fallos: 0,
    otros: 0,
    pctCompletado: 0,
    pudoTotal: 0,
    pudoEntregados: 0,
    pudoPendientes: 0,
    drivers: [],
    cps: [],
    cpsCount: 0,
    incidencias: [],
  };
  const validDates = rows.map((r) => r.fecha).filter((x): x is Date => !!x);
  if (validDates.length === 0) return empty;
  const maxTs = Math.max(...validDates.map(dayStart));
  const maxDate = new Date(maxTs);
  const dayRows = rows.filter((r) => r.fecha && dayStart(r.fecha) === maxTs);
  if (dayRows.length === 0) return empty;

  let completados = 0, devoluciones = 0, enReparto = 0, fallos = 0, otros = 0;
  let pudoTotal = 0, pudoEntregados = 0, pudoPendientes = 0;
  const driverMap = new Map<string, DriverAgg>();
  const cpMap = new Map<string, CpAgg>();
  const incMap = new Map<string, number>();

  for (const r of dayRows) {
    switch (r.categoria) {
      case "COMPLETADO": completados++; break;
      case "DEVOLUCION": devoluciones++; break;
      case "EN_REPARTO": enReparto++; break;
      case "FALLO": fallos++; break;
      default: otros++;
    }
    const tipo = r.tipoEntrega.trim().toUpperCase();
    if (tipo === "PUDO") {
      pudoTotal++;
      if (r.categoria === "COMPLETADO") pudoEntregados++;
      else if (r.categoria === "EN_REPARTO") pudoPendientes++;
    }
    const driverKey = r.driver || "— Sin asignar —";
    let d = driverMap.get(driverKey);
    if (!d) {
      d = { driver: driverKey, total: 0, entregado: 0, devolucion: 0, enReparto: 0, fallos: 0, otros: 0 };
      driverMap.set(driverKey, d);
    }
    d.total++;
    if (r.categoria === "COMPLETADO") d.entregado++;
    else if (r.categoria === "DEVOLUCION") d.devolucion++;
    else if (r.categoria === "EN_REPARTO") d.enReparto++;
    else if (r.categoria === "FALLO") d.fallos++;
    else d.otros++;

    const cpKey = `${driverKey}__${r.cp || "—"}`;
    let c = cpMap.get(cpKey);
    if (!c) {
      c = { driver: driverKey, cp: r.cp || "—", total: 0, completado: 0, enReparto: 0, fallos: 0 };
      cpMap.set(cpKey, c);
    }
    c.total++;
    if (r.categoria === "COMPLETADO" || r.categoria === "DEVOLUCION") c.completado++;
    else if (r.categoria === "EN_REPARTO") c.enReparto++;
    else if (r.categoria === "FALLO") c.fallos++;

    if (r.categoria === "FALLO" && r.incidencia) {
      incMap.set(r.incidencia, (incMap.get(r.incidencia) ?? 0) + 1);
    }
  }

  const totalDia = dayRows.length;
  const compBase = completados + devoluciones + enReparto + fallos;
  const pctCompletado = compBase > 0 ? ((completados + devoluciones) / compBase) * 100 : 0;

  const drivers = Array.from(driverMap.values()).sort((a, b) => b.total - a.total);
  const cps = Array.from(cpMap.values()).sort((a, b) => b.enReparto - a.enReparto || b.total - a.total);
  const cpsUnique = new Set(cps.map((c) => c.cp)).size;
  const incidencias = Array.from(incMap.entries())
    .map(([nombre, count]) => ({ nombre, count }))
    .sort((a, b) => b.count - a.count);

  return {
    maxDate,
    totalDia,
    completados,
    devoluciones,
    enReparto,
    fallos,
    otros,
    pctCompletado,
    pudoTotal,
    pudoEntregados,
    pudoPendientes,
    drivers,
    cps,
    cpsCount: cpsUnique,
    incidencias,
  };
}

// Estado normalizado (epod_lineas.estado ya viene normalizado por
// normalizeEstado() al subir el ePOD en /epod) — categorizar() ya compara en
// minúsculas, así que "Driver_received"/"Entregado"/etc. matchean igual que
// si vinieran de un Excel recién subido.
type EpodLineaFlowRow = {
  waybill: string | null;
  fecha: string | null;
  estado: string | null;
  cp: string | null;
  driver: string | null;
  tipo: string | null;
  market_place_name: string | null;
  seller_name: string | null;
  exception_detail: string | null;
  row_index: number;
};

// Carga paginada (1000 filas por página) — epod_lineas primero (histórico
// crudo); si un hub no tiene nada ahí para esa fecha (uploads viejos previos
// a epod_lineas), cae a entregas, que no tiene mercado/vendedor/incidencia
// (quedan vacíos).
export async function fetchDbRowsForHubDate(hubId: string, fecha: string): Promise<EpodLineaFlowRow[]> {
  const pageSize = 1000;
  const fromLineas: EpodLineaFlowRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("epod_lineas")
      .select("waybill, fecha, estado, cp, driver, tipo, market_place_name, seller_name, exception_detail, row_index")
      .eq("hub_id", hubId)
      .eq("fecha", fecha)
      .order("row_index", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    fromLineas.push(...page);
    if (page.length < pageSize) break;
  }
  if (fromLineas.length > 0) return fromLineas;

  const fromEntregas: EpodLineaFlowRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("entregas")
      .select("waybill, fecha, estado, cp, driver, tipo")
      .eq("hub_id", hubId)
      .eq("fecha", fecha)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    fromEntregas.push(
      ...page.map((r, i) => ({
        ...r,
        market_place_name: null,
        seller_name: null,
        exception_detail: null,
        row_index: from + i,
      })),
    );
    if (page.length < pageSize) break;
  }
  return fromEntregas;
}

export function dbRowsToRawRows(dbRows: EpodLineaFlowRow[]): RawRow[] {
  return dbRows.map((r) => {
    const estado = r.estado ?? "";
    return {
      waybill: r.waybill ?? "",
      fecha: r.fecha ? new Date(`${r.fecha}T00:00:00`) : null,
      estado,
      categoria: categorizar(estado),
      incidencia: r.exception_detail ?? "",
      cp: r.cp ?? "",
      driver: r.driver ?? "",
      tipoEntrega: r.tipo ?? "",
      mercado: r.market_place_name ?? "",
      vendedor: r.seller_name ?? "",
      rowIndex: r.row_index,
    };
  });
}

// Usado tanto por la carga "desde la base" de /flow-meeting como por el
// trigger de caché de /epod y el backfill masivo — un solo lugar con la
// lógica de "traer + calcular".
export async function computeFlowMeetingForDate(hubId: string, fecha: string): Promise<Analysis> {
  const dbRows = await fetchDbRowsForHubDate(hubId, fecha);
  const rawRows = dbRowsToRawRows(dbRows);
  return analyze(rawRows);
}
