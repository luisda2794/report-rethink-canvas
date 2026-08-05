import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FileSpreadsheet,
  X,
  AlertCircle,
  ArrowLeft,
  Settings,
  Download,
  History,
  Info,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { isDeliveredEstado, isFailedEstado } from "@/lib/resolve-event-date";
import { getClientesLocalesConfig, isClienteLocal, type CpLocalidad } from "@/lib/clientes-locales-config";
import { categorizeCliente, type Categoria } from "@/lib/client-category";
import { exportStyledExcel } from "@/lib/xlsx-export";
import {
  getHistorico,
  saveHistorico,
  getDiaSnapshot,
  saveDiaSnapshot,
  type HistoricoEntry,
  type HistoricoStore,
  type DiaSnapshot,
  type DiaSnapshotEntry,
  type EstadoActual,
} from "@/lib/clientes-locales-snapshots";

export const Route = createFileRoute("/reportes_/clientes-locales")({
  component: () => (
    <RequireAuth path="/reportes">
      <ClientesLocalesPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Clientes Locales" },
      {
        name: "description",
        content:
          "Clientes locales en reparto, flow meeting por CP y % CD4/CD5 (SHEIN, resto de locales, TEMU, Aliexpress), a partir de dos EPOD (histórico + del día).",
      },
    ],
  }),
});

// ---------------------------------------------------------------------------
// Resolución de columnas (español / inglés)
// ---------------------------------------------------------------------------

const REQUIRED_ALIASES = {
  waybill: ["Número de Waybill", "Waybill Number"],
  fecha: ["Fecha de la tarea", "Task Date"],
  estado: ["Estado de la Tarea", "Task Status"],
  incidencia: ["Detalles de la Excepción", "Exception Detail"],
  cp: ["Código postal", "Zip Code"],
  direccion: ["Dirección detallada", "Detailed address"],
  driver: ["Nombre del Repartidor", "Courier Name"],
  mercado: ["Nombre del mercado", "Market Place Name"],
  vendedor: ["Nombre del vendedor", "Seller Name"],
} as const;
type RequiredField = keyof typeof REQUIRED_ALIASES;

function resolveColumns(
  headers: string[],
): { cols: Record<RequiredField, string>; missing?: never } | { cols?: never; missing: string[] } {
  const cols = {} as Record<RequiredField, string>;
  const missing: string[] = [];
  for (const field of Object.keys(REQUIRED_ALIASES) as RequiredField[]) {
    const aliases = REQUIRED_ALIASES[field];
    const found = aliases.find((a) => headers.includes(a));
    if (found) cols[field] = found;
    else missing.push(aliases.join(" / "));
  }
  return missing.length > 0 ? { missing } : { cols };
}

// El histórico necesita waybill/fecha/cp/driver/estado/incidencia/mercado/vendedor:
// T0, Cliente Local, categoría, estado actual y última incidencia (para los
// reportes % CD4/CD5).
const HISTORICO_ALIASES = {
  waybill: ["Número de Waybill", "Waybill Number"],
  fecha: ["Fecha de la tarea", "Task Date"],
  cp: ["Código postal", "Zip Code"],
  driver: ["Nombre del Repartidor", "Courier Name"],
  estado: ["Estado de la Tarea", "Task Status"],
  incidencia: ["Detalles de la Excepción", "Exception Detail"],
  mercado: ["Nombre del mercado", "Market Place Name"],
  vendedor: ["Nombre del vendedor", "Seller Name"],
} as const;
type HistoricoField = keyof typeof HISTORICO_ALIASES;

function resolveHistoricoColumns(
  headers: string[],
): { cols: Record<HistoricoField, string>; missing?: never } | { cols?: never; missing: string[] } {
  const cols = {} as Record<HistoricoField, string>;
  const missing: string[] = [];
  for (const field of Object.keys(HISTORICO_ALIASES) as HistoricoField[]) {
    const aliases = HISTORICO_ALIASES[field];
    const found = aliases.find((a) => headers.includes(a));
    if (found) cols[field] = found;
    else missing.push(aliases.join(" / "));
  }
  return missing.length > 0 ? { missing } : { cols };
}

function parseFecha(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    const utcDays = Math.floor(v - 25569);
    const utcMs = utcDays * 86400 * 1000 + (v - Math.floor(v)) * 86400 * 1000;
    return new Date(utcMs);
  }
  const s = String(v).trim();
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

function dayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const isToday = d.toDateString() === new Date().toDateString();
  return isToday ? `hoy ${time}` : `${d.toLocaleDateString("es-ES")} ${time}`;
}

// ---------------------------------------------------------------------------
// Clasificación de estado (mismas variantes español/inglés que el resto de la app)
// ---------------------------------------------------------------------------

function normalizeEstado(s: string): string {
  return s.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
function isEnRepartoEstado(s: string): boolean {
  const n = normalizeEstado(s);
  return n === "driver received" || n === "driver received incidencias" || n === "driver received incidence" || n === "driver received incidencia";
}
function isCancelarEstado(s: string): boolean {
  const n = normalizeEstado(s);
  return n === "cancelar" || n === "cancel" || n === "cancelled" || n === "canceled";
}
function isAsignadoEstado(s: string): boolean {
  const n = normalizeEstado(s);
  return n === "asignado" || n === "assigned";
}
function classifyEstadoActual(estado: string): EstadoActual {
  if (isDeliveredEstado(estado)) return "ENTREGADO";
  if (isEnRepartoEstado(estado)) return "EN_REPARTO";
  if (isFailedEstado(estado)) return "FALLO";
  if (isCancelarEstado(estado)) return "CANCELADO";
  if (isAsignadoEstado(estado)) return "ASIGNADO";
  return "OTRO";
}
const ESTADO_LABEL: Record<EstadoActual, string> = {
  ENTREGADO: "Entregado",
  EN_REPARTO: "En Reparto",
  FALLO: "Fallado",
  CANCELADO: "Cancelado",
  ASIGNADO: "Asignado",
  OTRO: "—",
};
// Prioridad para resolver el "estado de hoy" cuando un waybill tiene más de
// una fila con la misma Fecha de la tarea (el Task Date no cambia con cada
// transición de estado, así que no sirve para ordenar cronológicamente):
// Entregado > En Reparto > En Incidencia > Cancelado > Asignado.
const ESTADO_PRIORITY: Record<EstadoActual, number> = {
  ENTREGADO: 5,
  EN_REPARTO: 4,
  FALLO: 3,
  CANCELADO: 2,
  ASIGNADO: 1,
  OTRO: 0,
};
// Entre varias filas del mismo waybill (mismo día o no), elige la de mayor
// prioridad de estado; en empate, la más reciente por fecha/orden de fila.
function pickBestRow(rs: RawRow[]): RawRow {
  return [...rs].sort((a, b) => {
    const pa = ESTADO_PRIORITY[classifyEstadoActual(a.estado)];
    const pb = ESTADO_PRIORITY[classifyEstadoActual(b.estado)];
    if (pa !== pb) return pb - pa;
    const at = a.fecha?.getTime() ?? 0;
    const bt = b.fecha?.getTime() ?? 0;
    if (at !== bt) return bt - at;
    return b.rowIndex - a.rowIndex;
  })[0];
}
// Regla de negocio del "estado de hoy" de un waybill: si tiene alguna fila
// con Fecha de la tarea = fecha más reciente del archivo, se usa la de mayor
// prioridad de ese día. Si no tiene ninguna fila hoy (su última actividad fue
// un día anterior y ya no aparece más), se asume resuelto → Entregado.
function resolveWaybillToday(rs: RawRow[], nowTs: number): { row: RawRow; estadoActual: EstadoActual } {
  const todayRows = rs.filter((r) => r.fecha && dayStart(r.fecha) === nowTs);
  if (todayRows.length > 0) {
    const row = pickBestRow(todayRows);
    return { row, estadoActual: classifyEstadoActual(row.estado) };
  }
  return { row: pickBestRow(rs), estadoActual: "ENTREGADO" };
}
function computeBadgeLabel(prevEstado: EstadoActual | undefined, currEstado: EstadoActual): string {
  if (currEstado === "EN_REPARTO") return prevEstado === "EN_REPARTO" ? "Sigue en reparto" : "Nuevo en reparto";
  if (currEstado === "ENTREGADO") return prevEstado === "EN_REPARTO" ? "Recién entregado" : "Entregado";
  if (currEstado === "FALLO") return prevEstado === "EN_REPARTO" ? "Recién fallado" : "Fallado";
  if (currEstado === "CANCELADO") return "Cancelado";
  return "—";
}

// ---------------------------------------------------------------------------
// Localidad
// ---------------------------------------------------------------------------

function localidadForCp(cp: string, mapping: CpLocalidad[]): string {
  const found = mapping.find((m) => m.cp.trim() !== "" && m.cp.trim() === cp.trim());
  return found?.localidad || "—";
}

// Excluye la Dirección Incorrecta de los reportes % CD4/CD5 (numerador Y
// denominador). Un intento fallido con motivo "Falta de Tiempo"/"Fuerza
// Mayor"/"Vehículo Averiado" NO se excluye — el waybill sigue en el
// denominador con normalidad, simplemente esa falla no cuenta como entrega.
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
const DIRECCION_INCORRECTA_VARIANTS = new Set([
  "direccion incorrecta",
  "dirreccion incorrecta",
  "address error",
]);
function isDireccionIncorrecta(s: string): boolean {
  return DIRECCION_INCORRECTA_VARIANTS.has(stripAccents(s).trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type RawRow = {
  waybill: string;
  fecha: Date | null;
  estado: string;
  incidencia: string;
  cp: string;
  direccion: string;
  driver: string;
  mercado: string;
  vendedor: string;
  cliente: string;
  clienteLocal: boolean;
  categoria: Categoria;
  rowIndex: number;
};

type Report1Row = {
  waybill: string;
  direccion: string;
  cliente: string;
  cp: string;
  localidad: string;
  driver: string;
  estado: EstadoActual;
  badgeLabel: string;
};

type CpGroup = {
  cp: string;
  localidad: string;
  rows: Report1Row[];
};

type ChangesSummary = {
  pasaronAEntregado: number;
  pasaronAFallado: number;
  siguenEnRepartoSinCambios: number;
};

type FlowRow = {
  cp: string;
  localidad: string;
  total: number;
  entregados: number;
  enReparto: number;
  cancelados: number;
  fallos: number;
  pctEntrega: number;
};

// ---------------------------------------------------------------------------
// % CD4 (SHEIN) / % CD5 (Resto Locales, TEMU, ALIEXPRESS)
//
// Reporte diario por COHORTE, no acumulado: el denominador (Total) es SOLO
// el cohorte de hoy — waybills cuyo T0 (inbound) fue hace EXACTAMENTE
// `windowDays` días (dias === windowDays), no "windowDays o más". Es el
// grupo específico que "cumple años" hoy y hay que evaluar.
// - % Entregado: de ESE cohorte (y solo de ese), cuántos ya llegaron a
//   Entregado/Delivered. KPI principal, target 99.5%, más alto es mejor.
// - Rompiendo: lista de SEGUIMIENTO aparte, que NO entra en el denominador
//   ni altera el % Entregado del día. Incluye todo waybill (de cualquier
//   cohorte, dias >= windowDays) que sigue HOY en
//   Driver_received/Driver_received_incidencias sin resolver — tanto los
//   arrastrados de días anteriores (dias > windowDays) como los del propio
//   cohorte de hoy que ya están en riesgo (dias === windowDays). Se muestra
//   como conteo absoluto + detalle, no como %.
// Se excluyen de ambas poblaciones los waybills cuya última incidencia sea
// Dirección Incorrecta. Fuente: el EPOD Histórico es la única fuente con el
// rastro de T0 a lo largo de varios días; el EPOD del Día complementa
// cp/driver/incidencia/estado actual (o sirve de único origen, con alcance
// más limitado, si no hay histórico cargado).
// ---------------------------------------------------------------------------

type CloseLoopEntry = {
  waybill: string;
  cliente: string; // ya con el alias aplicado (p.ej. "SHEIN")
  cp: string;
  driver: string;
  t0Ts: number;
  ultimaIncidencia: string;
  estadoActual: EstadoActual;
};

type CloseLoopBreakdownRow = {
  key: string;
  total: number;
  entregado: number;
  pctEntregado: number;
  rompiendo: number;
};

type CloseLoopDetalleRow = {
  waybill: string;
  cp: string;
  driver: string;
  dias: number;
  estadoActual: EstadoActual;
  ultimaIncidencia: string;
};

type CloseLoopReport = {
  total: number;
  entregado: number;
  pctEntregado: number;
  rompiendo: number;
  porCp: CloseLoopBreakdownRow[];
  porDriver: CloseLoopBreakdownRow[];
  // Rompiendo: arrastrados de días anteriores + cohorte de hoy en riesgo.
  // Ordenado por días desde inbound desc.
  detalleRompiendo: CloseLoopDetalleRow[];
};

function buildCloseLoop(entries: CloseLoopEntry[], windowDays: number, nowTs: number): CloseLoopReport {
  const diasDesdeT0 = (e: CloseLoopEntry) => Math.floor((nowTs - e.t0Ts) / 86400000);
  const isEnReparto = (e: CloseLoopEntry) => e.estadoActual === "EN_REPARTO";
  const isEntregado = (e: CloseLoopEntry) => e.estadoActual === "ENTREGADO";

  // Denominador: SOLO el cohorte de hoy (dias === windowDays).
  const cohorteHoy = entries.filter((e) => diasDesdeT0(e) === windowDays);
  // Rompiendo: cualquier cohorte ya vencida (dias >= windowDays) que sigue
  // en reparto hoy — no se usa como denominador de ningún %.
  const rompiendoPop = entries.filter((e) => diasDesdeT0(e) >= windowDays && isEnReparto(e));

  const total = cohorteHoy.length;
  const entregado = cohorteHoy.filter(isEntregado).length;
  const pctEntregado = total > 0 ? (entregado / total) * 100 : 0;
  const rompiendo = rompiendoPop.length;

  const buildBreakdown = (keyFn: (e: CloseLoopEntry) => string): CloseLoopBreakdownRow[] => {
    const map = new Map<string, { total: number; entregado: number; rompiendo: number }>();
    for (const e of cohorteHoy) {
      const key = keyFn(e) || "—";
      const b = map.get(key) ?? { total: 0, entregado: 0, rompiendo: 0 };
      b.total++;
      if (isEntregado(e)) b.entregado++;
      map.set(key, b);
    }
    for (const e of rompiendoPop) {
      const key = keyFn(e) || "—";
      const b = map.get(key) ?? { total: 0, entregado: 0, rompiendo: 0 };
      b.rompiendo++;
      map.set(key, b);
    }
    return Array.from(map.entries())
      .map(([key, b]) => ({
        key,
        total: b.total,
        entregado: b.entregado,
        pctEntregado: b.total > 0 ? (b.entregado / b.total) * 100 : 0,
        rompiendo: b.rompiendo,
      }))
      .sort((a, b) => b.total - a.total || b.rompiendo - a.rompiendo);
  };

  const detalleRompiendo: CloseLoopDetalleRow[] = rompiendoPop
    .map((e) => ({
      waybill: e.waybill,
      cp: e.cp || "—",
      driver: e.driver || "— Sin asignar —",
      dias: diasDesdeT0(e),
      estadoActual: e.estadoActual,
      ultimaIncidencia: e.ultimaIncidencia || "Sin incidencias",
    }))
    .sort((a, b) => b.dias - a.dias);

  return {
    total,
    entregado,
    pctEntregado,
    rompiendo,
    porCp: buildBreakdown((e) => e.cp),
    porDriver: buildBreakdown((e) => e.driver || "— Sin asignar —"),
    detalleRompiendo,
  };
}

// % Entregado: semáforo normal — más alto es mejor, target 99.5%.
function entregadoColor(pct: number): string {
  if (pct >= 99.5) return "var(--success)";
  if (pct >= 95) return "var(--warn)";
  return "var(--danger)";
}

// % CD5 por categoría (TEMU / ALIEXPRESS): a diferencia de SHEIN/Resto
// Locales, NO depende de `clienteLocal` — usa `categoria` directamente
// (calculada para TODAS las filas del histórico y del día), porque TEMU y
// ALIEXPRESS por definición no son "cliente local" bajo la regla de
// exclude/include del módulo.
function buildCategoryCloseLoop(
  targetCategoria: Categoria,
  windowDays: number,
  rows: RawRow[],
  historico: HistoricoStore | null,
  nowTs: number,
): CloseLoopReport {
  const map = new Map<string, CloseLoopEntry>();
  if (historico) {
    for (const h of historico.entries) {
      if (h.categoria !== targetCategoria) continue;
      map.set(h.waybill, {
        waybill: h.waybill,
        cliente: h.cliente,
        cp: h.cp,
        driver: h.driver,
        t0Ts: dayStart(new Date(h.t0)),
        ultimaIncidencia: h.ultimaIncidencia,
        estadoActual: h.estadoActual,
      });
    }
  }

  const todayRows = rows.filter((r) => r.fecha && dayStart(r.fecha) === nowTs && r.categoria === targetCategoria);
  const byWaybillToday = new Map<string, RawRow[]>();
  for (const r of todayRows) {
    const arr = byWaybillToday.get(r.waybill) ?? [];
    arr.push(r);
    byWaybillToday.set(r.waybill, arr);
  }
  const seenToday = new Set<string>();
  for (const [waybill, rs] of byWaybillToday) {
    seenToday.add(waybill);
    const r = pickBestRow(rs);
    const estadoActual = classifyEstadoActual(r.estado);
    const existing = map.get(waybill);
    if (existing) {
      existing.cp = r.cp;
      existing.driver = r.driver;
      existing.estadoActual = estadoActual;
      if (r.incidencia.trim() !== "") existing.ultimaIncidencia = r.incidencia;
    } else {
      const datesForWaybill = rows
        .filter((x) => x.waybill === waybill && x.categoria === targetCategoria && x.fecha)
        .map((x) => dayStart(x.fecha!));
      const t0Ts = datesForWaybill.length > 0 ? Math.min(...datesForWaybill) : nowTs;
      map.set(waybill, {
        waybill,
        cliente: r.cliente,
        cp: r.cp,
        driver: r.driver,
        t0Ts,
        ultimaIncidencia: r.incidencia,
        estadoActual,
      });
    }
  }

  // Waybills que solo venían del histórico y hoy no tienen ninguna fila: se
  // asumen resueltos (Entregado), sin importar su último estado conocido.
  for (const [waybill, entry] of map) {
    if (!seenToday.has(waybill)) entry.estadoActual = "ENTREGADO";
  }

  const entries = Array.from(map.values()).filter((e) => !isDireccionIncorrecta(e.ultimaIncidencia));
  return buildCloseLoop(entries, windowDays, nowTs);
}

type Analysis = {
  epodDate: Date;
  epodDateStr: string;
  report1Groups: CpGroup[];
  report1Total: number;
  changesSummary: ChangesSummary;
  volumeByCp: { name: string; total: number }[];
  volumeByCliente: { name: string; total: number }[];
  flow: FlowRow[];
  snapshotToSave: DiaSnapshot;
  sheinCloseLoop: CloseLoopReport;
  localCloseLoop: CloseLoopReport;
  temuCloseLoop: CloseLoopReport;
  aliexpressCloseLoop: CloseLoopReport;
};

function analyze(rows: RawRow[], cpMapping: CpLocalidad[], historico: HistoricoStore | null): Analysis | null {
  const localRows = rows.filter((r) => r.clienteLocal && r.fecha && r.waybill);
  if (localRows.length === 0) return null;
  const maxTs = Math.max(...localRows.map((r) => dayStart(r.fecha!)));
  const epodDate = new Date(maxTs);
  const epodDateStr = formatDate(epodDate);

  // "Estado de hoy" por waybill: si tiene fila con Fecha de la tarea = hoy,
  // se usa la de mayor prioridad de ese día; si no tiene ninguna fila hoy
  // (su última actividad fue un día anterior y ya no aparece más), se asume
  // resuelto → Entregado.
  const allLocalByWaybill = new Map<string, RawRow[]>();
  for (const r of localRows) {
    const arr = allLocalByWaybill.get(r.waybill) ?? [];
    arr.push(r);
    allLocalByWaybill.set(r.waybill, arr);
  }
  const currentByWaybill = new Map<string, { row: RawRow; estadoActual: EstadoActual }>();
  for (const [waybill, rs] of allLocalByWaybill) {
    currentByWaybill.set(waybill, resolveWaybillToday(rs, maxTs));
  }

  // Snapshot anterior de HOY (antes de reemplazarlo).
  const prevSnapshot = getDiaSnapshot(epodDateStr);
  const prevByWaybill = new Map<string, EstadoActual>();
  if (prevSnapshot) for (const e of prevSnapshot.entries) prevByWaybill.set(e.waybill, e.estado);

  // ---- Reporte 1: todos los Cliente Local de hoy, con badge de cambio ----
  const report1RowsFlat: Report1Row[] = [];
  const snapshotEntries: DiaSnapshotEntry[] = [];
  for (const [waybill, { row: r, estadoActual }] of currentByWaybill) {
    const badgeLabel = computeBadgeLabel(prevByWaybill.get(waybill), estadoActual);
    const localidad = localidadForCp(r.cp, cpMapping);
    report1RowsFlat.push({
      waybill,
      direccion: r.direccion,
      cliente: r.cliente,
      cp: r.cp,
      localidad,
      driver: r.driver,
      estado: estadoActual,
      badgeLabel,
    });
    snapshotEntries.push({ waybill, estado: estadoActual, cp: r.cp, cliente: r.cliente, driver: r.driver, direccion: r.direccion });
  }

  const changesSummary: ChangesSummary = {
    pasaronAEntregado: report1RowsFlat.filter((r) => r.badgeLabel === "Recién entregado").length,
    pasaronAFallado: report1RowsFlat.filter((r) => r.badgeLabel === "Recién fallado").length,
    siguenEnRepartoSinCambios: report1RowsFlat.filter((r) => r.badgeLabel === "Sigue en reparto").length,
  };

  const cpGroupMap = new Map<string, CpGroup>();
  for (const r of report1RowsFlat) {
    const key = r.cp || "—";
    const g = cpGroupMap.get(key) ?? { cp: key, localidad: r.localidad, rows: [] };
    g.rows.push(r);
    cpGroupMap.set(key, g);
  }
  const report1Groups = Array.from(cpGroupMap.values())
    .map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => a.driver.localeCompare(b.driver)) }))
    .sort((a, b) => b.rows.length - a.rows.length);

  const volumeByCp = report1Groups.map((g) => ({ name: g.cp, total: g.rows.length }));

  const clienteMap = new Map<string, number>();
  for (const r of report1RowsFlat) {
    const key = r.cliente || "— Sin cliente —";
    clienteMap.set(key, (clienteMap.get(key) ?? 0) + 1);
  }
  const volumeByCliente = Array.from(clienteMap.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  // ---- Reporte 2: Flow Meeting por CP (sobre el estado actual, deduplicado) ----
  const flowMap = new Map<string, { entregados: number; enReparto: number; cancelados: number; fallos: number; total: number }>();
  for (const r of report1RowsFlat) {
    const key = r.cp || "—";
    const b = flowMap.get(key) ?? { entregados: 0, enReparto: 0, cancelados: 0, fallos: 0, total: 0 };
    b.total++;
    if (r.estado === "ENTREGADO") b.entregados++;
    else if (r.estado === "EN_REPARTO") b.enReparto++;
    else if (r.estado === "CANCELADO") b.cancelados++;
    else if (r.estado === "FALLO") b.fallos++;
    flowMap.set(key, b);
  }
  const flow: FlowRow[] = Array.from(flowMap.entries())
    .map(([cp, b]) => ({ cp, localidad: localidadForCp(cp, cpMapping), ...b, pctEntrega: b.total > 0 ? (b.entregados / b.total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);

  // ---- Reportes 4/5: % CD4 (SHEIN) y % CD5 (Resto de Clientes Locales) ----
  const closeLoopMap = new Map<string, CloseLoopEntry>();
  if (historico) {
    for (const h of historico.entries) {
      if (!h.clienteLocal) continue;
      closeLoopMap.set(h.waybill, {
        waybill: h.waybill,
        cliente: h.cliente,
        cp: h.cp,
        driver: h.driver,
        t0Ts: dayStart(new Date(h.t0)),
        ultimaIncidencia: h.ultimaIncidencia,
        estadoActual: h.estadoActual,
      });
    }
  }
  for (const [waybill, { row: r, estadoActual }] of currentByWaybill) {
    const existing = closeLoopMap.get(waybill);
    if (existing) {
      existing.cp = r.cp;
      existing.driver = r.driver;
      existing.estadoActual = estadoActual; // hoy (o Entregado forzado) siempre manda
      if (r.incidencia.trim() !== "") existing.ultimaIncidencia = r.incidencia;
    } else {
      const datesForWaybill = localRows.filter((x) => x.waybill === waybill).map((x) => dayStart(x.fecha!));
      const t0Ts = datesForWaybill.length > 0 ? Math.min(...datesForWaybill) : maxTs;
      closeLoopMap.set(waybill, {
        waybill,
        cliente: r.cliente,
        cp: r.cp,
        driver: r.driver,
        t0Ts,
        ultimaIncidencia: r.incidencia,
        estadoActual,
      });
    }
  }
  // Waybills que solo venían del histórico y hoy ya no aparecen en absoluto
  // en el EPOD del Día: se asumen resueltos (Entregado).
  for (const [waybill, entry] of closeLoopMap) {
    if (!currentByWaybill.has(waybill)) entry.estadoActual = "ENTREGADO";
  }
  const allCloseLoopEntries = Array.from(closeLoopMap.values()).filter((e) => !isDireccionIncorrecta(e.ultimaIncidencia));
  const sheinCloseLoop = buildCloseLoop(allCloseLoopEntries.filter((e) => e.cliente === "SHEIN"), 4, maxTs);
  const localCloseLoop = buildCloseLoop(allCloseLoopEntries.filter((e) => e.cliente !== "SHEIN"), 5, maxTs);

  // ---- Reportes 6/7: % CD5 por categoría (TEMU / ALIEXPRESS) ----
  // A diferencia de SHEIN/Resto Locales, estas dos categorías NO dependen de
  // `clienteLocal` — se basan directamente en `categoria` (calculada para
  // TODAS las filas), ya que TEMU/ALIEXPRESS por definición no son "cliente
  // local" bajo la regla de exclude/include.
  const temuCloseLoop = buildCategoryCloseLoop("TEMU", 5, rows, historico, maxTs);
  const aliexpressCloseLoop = buildCategoryCloseLoop("ALIEXPRESS", 5, rows, historico, maxTs);

  return {
    epodDate,
    epodDateStr,
    report1Groups,
    report1Total: report1RowsFlat.length,
    changesSummary,
    volumeByCp,
    volumeByCliente,
    flow,
    snapshotToSave: { fecha: epodDateStr, updatedAt: new Date().toISOString(), entries: snapshotEntries },
    sheinCloseLoop,
    localCloseLoop,
    temuCloseLoop,
    aliexpressCloseLoop,
  };
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function pctEntregaColor(pct: number): string {
  if (pct > 80) return "var(--success)";
  if (pct < 50) return "var(--danger)";
  return "var(--warn)";
}

const volumeChartConfig = {
  total: { label: "Paquetes", color: "var(--electric)" },
} satisfies ChartConfig;

function VolumeBarChart({ data }: { data: { name: string; total: number }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos.</p>;
  }
  return (
    <ChartContainer className="h-[220px] w-full" config={volumeChartConfig}>
      <BarChart data={data} margin={{ left: 8, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={10} interval={0} angle={-30} textAnchor="end" height={50} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={28} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

function Th({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <th className={`px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground ${right ? "text-right" : "text-left"} ${className}`}>
      {children}
    </th>
  );
}
function Td({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <td className={`px-3 py-1.5 ${right ? "text-right" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}

function StatBox({ label, value, tone }: { label: string; value: number; tone: "success" | "danger" | "muted" }) {
  const color = tone === "success" ? "var(--success)" : tone === "danger" ? "var(--danger)" : undefined;
  return (
    <div className="p-4 rounded-lg border bg-card">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

function Dropzone({
  label,
  hint,
  file,
  dragOver,
  loading,
  error,
  onFile,
  onDragOver,
  onDragLeave,
}: {
  label: string;
  hint: string;
  file: File | null;
  dragOver: boolean;
  loading: boolean;
  error: string | null;
  onFile: (f: File | null) => void;
  onDragOver: (v: boolean) => void;
  onDragLeave: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); onDragOver(true); }}
        onDragLeave={onDragLeave}
        onDrop={(e) => {
          e.preventDefault();
          onDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={`p-5 bg-card border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="size-6 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">{file.name}</div>
              <div className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFile(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label="Quitar archivo"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Upload className="size-6 text-primary" />
            <div>
              <div className="text-sm font-semibold text-foreground">{label}</div>
              <div className="text-xs">{hint}</div>
            </div>
          </div>
        )}
      </div>
      {loading && <p className="mt-2 text-xs text-muted-foreground">Procesando…</p>}
      {error && (
        <p className="mt-2 text-destructive text-xs flex items-start gap-1.5">
          <AlertCircle className="size-3 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

function CloseLoopSection({
  windowDays,
  report,
  hasHistorico,
  onExport,
}: {
  windowDays: number;
  report: CloseLoopReport;
  hasHistorico: boolean;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {!hasHistorico && (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5 p-3 rounded-md border bg-muted">
          <Info className="size-3.5 mt-0.5 shrink-0" />
          <span>
            Sube un EPOD Histórico para un cálculo completo. Sin él, el cohorte de hoy solo puede formarse con
            waybills vistos en el EPOD del día de hoy.
          </span>
        </p>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Cohorte de hoy (T0 hace exactamente {windowDays} días): % Entregado (target 99.5%, más alto = mejor) ·
          Rompiendo es una lista de seguimiento aparte (arrastrados de días anteriores + cohorte de hoy en riesgo),
          no altera el % · excluye Dirección Incorrecta
        </p>
        <Button onClick={onExport} disabled={report.total === 0 && report.rompiendo === 0} size="sm" className="gap-2">
          <Download className="size-3.5" /> Exportar a Excel
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        <div className="p-4 rounded-lg border bg-card">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">% Entregado — Cohorte de hoy (target 99.5%)</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums" style={{ color: entregadoColor(report.pctEntregado) }}>
            {report.total > 0 ? `${report.pctEntregado.toFixed(1)}%` : "—"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {report.entregado} de {report.total} del cohorte de hoy (T0 hace {windowDays}d)
          </div>
        </div>
        <div className="p-4 rounded-lg border bg-card">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Rompiendo (seguimiento, no es %)</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-foreground">{report.rompiendo}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            en Driver_received sin resolver — arrastrados + cohorte de hoy
          </div>
        </div>
      </div>

      {report.total === 0 ? (
        <Card className="shadow-none">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Todavía no hay paquetes cuyo T0 sea hace exactamente {windowDays} días (cohorte de hoy).
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Por CP</h4>
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-muted">
                  <tr>
                    <Th>CP</Th>
                    <Th right>Total</Th>
                    <Th right>Entregado</Th>
                    <Th right>% Entregado</Th>
                    <Th right>Rompiendo</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.porCp.map((r) => (
                    <tr key={r.key} className="border-t border-border">
                      <Td className="whitespace-nowrap">{r.key}</Td>
                      <Td right className="tabular-nums">{r.total}</Td>
                      <Td right className="tabular-nums">{r.entregado}</Td>
                      <Td right className="tabular-nums font-semibold">
                        <span style={{ color: entregadoColor(r.pctEntregado) }}>{r.pctEntregado.toFixed(1)}%</span>
                      </Td>
                      <Td right className="tabular-nums">{r.rompiendo}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Por Driver</h4>
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-muted">
                  <tr>
                    <Th>Driver</Th>
                    <Th right>Total</Th>
                    <Th right>Entregado</Th>
                    <Th right>% Entregado</Th>
                    <Th right>Rompiendo</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.porDriver.map((r) => (
                    <tr key={r.key} className="border-t border-border">
                      <Td className="whitespace-nowrap">{r.key}</Td>
                      <Td right className="tabular-nums">{r.total}</Td>
                      <Td right className="tabular-nums">{r.entregado}</Td>
                      <Td right className="tabular-nums font-semibold">
                        <span style={{ color: entregadoColor(r.pctEntregado) }}>{r.pctEntregado.toFixed(1)}%</span>
                      </Td>
                      <Td right className="tabular-nums">{r.rompiendo}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {report.rompiendo > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">
            Rompiendo — Arrastrados y Cohorte de Hoy en Riesgo (a atacar)
            <span className="ml-2 text-[11px] text-muted-foreground font-normal">
              ({report.detalleRompiendo.length}) · T0 hace {windowDays}+ días y todavía en Driver_received hoy
            </span>
          </h4>
          {report.detalleRompiendo.length === 0 ? (
            <Card className="shadow-none">
              <CardContent className="pt-6 text-sm text-muted-foreground">
                ✓ Ningún paquete con T0 vencido sigue en reparto sin resolverse.
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-muted">
                  <tr>
                    <Th>Waybill</Th>
                    <Th>CP</Th>
                    <Th>Driver</Th>
                    <Th right>Días desde Inbound</Th>
                    <Th>Estado Actual</Th>
                    <Th>Última Incidencia</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.detalleRompiendo.map((r) => (
                    <tr key={r.waybill} className="border-t border-border">
                      <Td className="whitespace-nowrap">{r.waybill}</Td>
                      <Td className="whitespace-nowrap">{r.cp}</Td>
                      <Td className="whitespace-nowrap">{r.driver}</Td>
                      <Td right className="tabular-nums font-semibold text-destructive">{r.dias}d</Td>
                      <Td className="whitespace-nowrap">{ESTADO_LABEL[r.estadoActual]}</Td>
                      <Td className="max-w-[240px] truncate" title={r.ultimaIncidencia}>{r.ultimaIncidencia}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DashboardCard({ title, report, onClick }: { title: string; report: CloseLoopReport; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left p-5 rounded-lg border bg-card hover:border-primary/50 transition-colors cursor-pointer"
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 text-4xl font-semibold tabular-nums" style={{ color: entregadoColor(report.pctEntregado) }}>
        {report.total > 0 ? `${report.pctEntregado.toFixed(1)}%` : "—"}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {report.total > 0
          ? `${report.entregado} de ${report.total} del cohorte de hoy`
          : "Sin cohorte con T0 hoy"}
      </div>
      {report.rompiendo > 0 && (
        <div className="mt-2 pt-2 border-t border-border flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Rompiendo (seguimiento)</span>
          <span className="font-semibold tabular-nums text-foreground">{report.rompiendo}</span>
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function ClientesLocalesPage() {
  const [historicoFile, setHistoricoFile] = useState<File | null>(null);
  const [historicoDragOver, setHistoricoDragOver] = useState(false);
  const [historicoLoading, setHistoricoLoading] = useState(false);
  const [historicoError, setHistoricoError] = useState<string | null>(null);
  const [historicoInfo, setHistoricoInfo] = useState<{ count: number; updatedAt: string } | null>(() => {
    const h = getHistorico();
    return h ? { count: h.entries.length, updatedAt: h.updatedAt } : null;
  });

  const [diaFile, setDiaFile] = useState<File | null>(null);
  const [diaDragOver, setDiaDragOver] = useState(false);
  const [diaLoading, setDiaLoading] = useState(false);
  const [diaError, setDiaError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<string | null>(() => {
    const snap = getDiaSnapshot(formatDate(new Date()));
    return snap?.updatedAt ?? null;
  });
  const [activeTab, setActiveTab] = useState("dashboard");

  const handleHistorico = async (f: File | null) => {
    setHistoricoFile(f);
    setHistoricoError(null);
    if (!f) return;
    setHistoricoLoading(true);
    try {
      const config = getClientesLocalesConfig();
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("El archivo no tiene hojas.");
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
      if (json.length === 0) throw new Error("El archivo está vacío.");
      const headers = Object.keys(json[0]);
      const resolved = resolveHistoricoColumns(headers);
      if (resolved.missing) {
        throw new Error(
          `Faltan columnas: ${resolved.missing.join(", ")}. Verifica el formato del archivo (se aceptan EPOD en español o en inglés).`,
        );
      }
      const cols = resolved.cols;
      type HistRow = {
        waybill: string;
        fecha: Date | null;
        cp: string;
        driver: string;
        estado: string;
        incidencia: string;
        cliente: string;
        clienteLocal: boolean;
        categoria: Categoria;
      };
      const parsed: HistRow[] = json.map((r) => {
        const mercado = String(r[cols.mercado] ?? "").trim();
        const vendedor = String(r[cols.vendedor] ?? "").trim();
        const { cliente, categoria } = categorizeCliente(mercado, vendedor, config);
        return {
          waybill: String(r[cols.waybill] ?? "").trim(),
          fecha: parseFecha(r[cols.fecha]),
          cp: String(r[cols.cp] ?? "").trim(),
          driver: String(r[cols.driver] ?? "").trim(),
          estado: String(r[cols.estado] ?? "").trim(),
          incidencia: String(r[cols.incidencia] ?? "").trim(),
          cliente,
          categoria,
          clienteLocal: isClienteLocal(mercado, vendedor, config),
        };
      });
      // No se filtra solo por clienteLocal: TEMU/ALIEXPRESS también necesitan
      // su T0 para los reportes % CD4/CD5 por categoría.
      const validRows = parsed.filter((r) => r.fecha && r.waybill);
      if (validRows.length === 0) throw new Error("No se encontraron waybills con fecha válida en este archivo.");
      const byWaybill = new Map<string, HistRow[]>();
      for (const r of validRows) {
        const arr = byWaybill.get(r.waybill) ?? [];
        arr.push(r);
        byWaybill.set(r.waybill, arr);
      }
      const entries: HistoricoEntry[] = [];
      for (const [waybill, rs] of byWaybill) {
        const sorted = [...rs].sort((a, b) => a.fecha!.getTime() - b.fecha!.getTime());
        const t0 = sorted[0].fecha!;
        const last = sorted[sorted.length - 1];
        const withInc = sorted.filter((r) => r.incidencia.trim() !== "");
        entries.push({
          waybill,
          t0: t0.toISOString(),
          cp: last.cp,
          cliente: last.cliente,
          driver: last.driver,
          clienteLocal: last.clienteLocal,
          categoria: last.categoria,
          estadoActual: classifyEstadoActual(last.estado),
          ultimaIncidencia: withInc.length > 0 ? withInc[withInc.length - 1].incidencia : "",
        });
      }
      saveHistorico(entries);
      setHistoricoInfo({ count: entries.length, updatedAt: new Date().toISOString() });
    } catch (e) {
      setHistoricoError(e instanceof Error ? e.message : "Error leyendo el archivo.");
      setHistoricoFile(null);
    } finally {
      setHistoricoLoading(false);
    }
  };

  const handleDia = async (f: File | null) => {
    setDiaFile(f);
    setDiaError(null);
    if (!f) return;
    setDiaLoading(true);
    try {
      const config = getClientesLocalesConfig();
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("El archivo no tiene hojas.");
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
      if (json.length === 0) throw new Error("El archivo está vacío.");
      const headers = Object.keys(json[0]);
      const resolved = resolveColumns(headers);
      if (resolved.missing) {
        throw new Error(
          `Faltan columnas: ${resolved.missing.join(", ")}. Verifica el formato del archivo (se aceptan EPOD en español o en inglés).`,
        );
      }
      const cols = resolved.cols;
      const parsed: RawRow[] = json.map((r, i) => {
        const mercado = String(r[cols.mercado] ?? "").trim();
        const vendedor = String(r[cols.vendedor] ?? "").trim();
        const { cliente, categoria } = categorizeCliente(mercado, vendedor, config);
        return {
          waybill: String(r[cols.waybill] ?? "").trim(),
          fecha: parseFecha(r[cols.fecha]),
          estado: String(r[cols.estado] ?? "").trim(),
          incidencia: String(r[cols.incidencia] ?? "").trim(),
          cp: String(r[cols.cp] ?? "").trim(),
          direccion: String(r[cols.direccion] ?? "").trim(),
          driver: String(r[cols.driver] ?? "").trim(),
          mercado,
          vendedor,
          cliente,
          categoria,
          clienteLocal: isClienteLocal(mercado, vendedor, config),
          rowIndex: i,
        };
      });
      // DEBUG TEMPORAL — quitar una vez confirmado el causante de "SHEIN en 0".
      // Muestra los valores únicos y crudos (tal cual vienen del Excel, antes
      // de aplicar el alias) de mercado/vendedor para verificar mayúsculas,
      // espacios u otro texto distinto al esperado ("INFINITE REMIT").
      console.log("[DEBUG SHEIN] valores únicos de mercado:", Array.from(new Set(parsed.map((r) => r.mercado))));
      console.log("[DEBUG SHEIN] valores únicos de vendedor:", Array.from(new Set(parsed.map((r) => r.vendedor))));
      const historico = getHistorico();
      const result = analyze(parsed, config.cpMapping, historico);
      if (!result) {
        setAnalysis(null);
        throw new Error("No se encontraron clientes locales con fecha válida en este archivo.");
      }
      saveDiaSnapshot(result.snapshotToSave);
      setAnalysis(result);
      setLastUpdateAt(result.snapshotToSave.updatedAt);
    } catch (e) {
      setDiaError(e instanceof Error ? e.message : "Error leyendo el archivo.");
      setDiaFile(null);
    } finally {
      setDiaLoading(false);
    }
  };

  const exportReport1 = () => {
    if (!analysis) return;
    const rowsOut = analysis.report1Groups.flatMap((g) =>
      g.rows.map((r) => [r.waybill, r.direccion, r.cliente, r.cp, r.localidad, r.driver, ESTADO_LABEL[r.estado], r.badgeLabel]),
    );
    if (rowsOut.length === 0) return;
    exportStyledExcel({
      title: "Clientes Locales en Reparto",
      date: analysis.epodDateStr,
      headers: ["Waybill", "Dirección", "Cliente", "CP", "Localidad", "Driver", "Estado Actual", "Cambio"],
      rows: rowsOut,
      filename: `clientes_locales_en_reparto_${analysis.epodDateStr}.xlsx`,
      colWidths: [22, 40, 24, 10, 20, 22, 14, 20],
    });
  };

  const exportFlow = () => {
    if (!analysis || analysis.flow.length === 0) return;
    exportStyledExcel({
      title: "Clientes Locales — Flow Meeting",
      date: analysis.epodDateStr,
      headers: ["CP", "Localidad", "Total", "Entregados", "En Reparto", "Cancelados", "Fallos", "% Entrega"],
      rows: analysis.flow.map((f) => [f.cp, f.localidad, f.total, f.entregados, f.enReparto, f.cancelados, f.fallos, Number(f.pctEntrega.toFixed(1))]),
      filename: `clientes_locales_flow_meeting_${analysis.epodDateStr}.xlsx`,
      colWidths: [10, 20, 8, 12, 12, 12, 10, 12],
    });
  };

  // Un solo export genérico para los 4 reportes % CD4/CD5 (SHEIN/Resto
  // Locales/TEMU/ALIEXPRESS): mismas columnas, mismo semáforo, y ahora
  // también el detalle de los que rompen el umbral en el mismo archivo.
  const exportCloseLoop = (report: CloseLoopReport, title: string, filenamePrefix: string) => {
    if (!analysis || (report.total === 0 && report.rompiendo === 0)) return;
    const rows: (string | number)[][] = [
      [
        "General",
        "-",
        report.total,
        report.entregado,
        Number(report.pctEntregado.toFixed(1)),
        report.rompiendo,
        "",
        "",
        "",
        "",
        "",
      ],
    ];
    for (const c of report.porCp) {
      rows.push([
        "CP",
        c.key,
        c.total,
        c.entregado,
        Number(c.pctEntregado.toFixed(1)),
        c.rompiendo,
        "",
        "",
        "",
        "",
        "",
      ]);
    }
    for (const d of report.porDriver) {
      rows.push([
        "Driver",
        d.key,
        d.total,
        d.entregado,
        Number(d.pctEntregado.toFixed(1)),
        d.rompiendo,
        "",
        "",
        "",
        "",
        "",
      ]);
    }
    for (const n of report.detalleRompiendo) {
      rows.push(["Detalle", n.waybill, "", "", "", "", n.cp, n.driver, n.dias, ESTADO_LABEL[n.estadoActual], n.ultimaIncidencia]);
    }
    exportStyledExcel({
      title,
      date: analysis.epodDateStr,
      headers: [
        "Nivel",
        "Clave",
        "Total (cohorte hoy)",
        "Entregado",
        "% Entregado",
        "Rompiendo",
        "CP",
        "Driver",
        "Días desde Inbound",
        "Estado Actual",
        "Última Incidencia",
      ],
      rows,
      filename: `${filenamePrefix}_${analysis.epodDateStr}.xlsx`,
      colWidths: [10, 22, 14, 10, 12, 10, 8, 20, 10, 14, 28],
      rowFill: (row) => {
        if (row[0] === "Detalle") return "FADBD8";
        const pct = Number(row[4]);
        if (pct >= 99.5) return undefined;
        if (pct >= 95) return "FEF3C7";
        return "FADBD8";
      },
    });
  };

  const exportSheinCloseLoop = () => analysis && exportCloseLoop(analysis.sheinCloseLoop, "SHEIN — % CD4", "shein_cd4");
  const exportLocalCloseLoop = () => analysis && exportCloseLoop(analysis.localCloseLoop, "Resto de Clientes Locales — % CD5", "resto_locales_cd5");
  const exportTemuCloseLoop = () => analysis && exportCloseLoop(analysis.temuCloseLoop, "TEMU — % CD5", "temu_cd5");
  const exportAliexpressCloseLoop = () => analysis && exportCloseLoop(analysis.aliexpressCloseLoop, "ALIEXPRESS/Dropshipper China — % CD5", "aliexpress_cd5");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link to="/reportes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Volver a Reportes
        </Link>
        <Link to="/reportes/clientes-locales/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <Settings className="size-3.5" /> Configuración
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Clientes Locales</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Clientes locales en reparto, flow meeting por CP, y % CD4/CD5 de SHEIN, resto de locales, TEMU y Aliexpress.
          {analysis && (
            <>
              {" "}Fecha del EPOD del día <strong>{analysis.epodDateStr}</strong>
            </>
          )}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="size-4 text-primary" /> 1. EPOD Histórico (opcional si ya lo subiste antes)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Dropzone
              label="Sube el EPOD histórico (multi-día)"
              hint="Calcula T0 (inbound) por waybill — habilita los % CD4/CD5 del Dashboard · .xlsx"
              file={historicoFile}
              dragOver={historicoDragOver}
              loading={historicoLoading}
              error={historicoError}
              onFile={(f) => void handleHistorico(f)}
              onDragOver={setHistoricoDragOver}
              onDragLeave={() => setHistoricoDragOver(false)}
            />
            {historicoInfo && (
              <p className="mt-2 text-xs text-muted-foreground">
                {historicoInfo.count} waybills cargados · actualizado {formatUpdatedAt(historicoInfo.updatedAt)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-primary" /> 2. EPOD del Día (súbelo cada vez que quieras actualizar)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Dropzone
              label="Sube el EPOD del día (Cainiao)"
              hint="Foto en vivo del reparto de hoy · .xlsx"
              file={diaFile}
              dragOver={diaDragOver}
              loading={diaLoading}
              error={diaError}
              onFile={(f) => void handleDia(f)}
              onDragOver={setDiaDragOver}
              onDragLeave={() => setDiaDragOver(false)}
            />
            {lastUpdateAt && (
              <p className="mt-2 text-xs text-muted-foreground">Última actualización: {formatUpdatedAt(lastUpdateAt)}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {analysis && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="enreparto">Clientes Locales en Reparto</TabsTrigger>
            <TabsTrigger value="flow">Flow Meeting</TabsTrigger>
            <TabsTrigger value="shein-cd4">SHEIN CD4 %</TabsTrigger>
            <TabsTrigger value="local-cd5">Resto Locales CD5 %</TabsTrigger>
            <TabsTrigger value="temu-cd5">TEMU CD5 %</TabsTrigger>
            <TabsTrigger value="aliexpress-cd5">Aliexpress CD5 %</TabsTrigger>
          </TabsList>

          {/* DASHBOARD */}
          <TabsContent value="dashboard" className="flex flex-col gap-4 mt-4">
            <p className="text-sm text-muted-foreground">
              % que rompe CD4/CD5 por categoría (más bajo = mejor) — click en una tarjeta para ver el detalle completo.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <DashboardCard title="CD4 SHEIN %" report={analysis.sheinCloseLoop} onClick={() => setActiveTab("shein-cd4")} />
              <DashboardCard title="CD5 Clientes Locales %" report={analysis.localCloseLoop} onClick={() => setActiveTab("local-cd5")} />
              <DashboardCard title="CD5 TEMU %" report={analysis.temuCloseLoop} onClick={() => setActiveTab("temu-cd5")} />
              <DashboardCard title="CD5 Aliexpress/Dropshipper China %" report={analysis.aliexpressCloseLoop} onClick={() => setActiveTab("aliexpress-cd5")} />
            </div>
          </TabsContent>

          {/* REPORTE 1 */}
          <TabsContent value="enreparto" className="flex flex-col gap-4 mt-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">¿Qué cambió desde la última actualización?</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatBox label="Pasaron a Entregado" value={analysis.changesSummary.pasaronAEntregado} tone="success" />
                <StatBox label="Pasaron a Fallado" value={analysis.changesSummary.pasaronAFallado} tone="danger" />
                <StatBox label="Siguen en reparto sin cambios" value={analysis.changesSummary.siguenEnRepartoSinCambios} tone="muted" />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{analysis.report1Total} paquetes de clientes locales hoy</p>
              <Button onClick={exportReport1} disabled={analysis.report1Total === 0} size="sm" className="gap-2">
                <Download className="size-3.5" /> Exportar a Excel
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="shadow-none">
                <CardHeader><CardTitle className="text-sm">Volumen por CP</CardTitle></CardHeader>
                <CardContent><VolumeBarChart data={analysis.volumeByCp} /></CardContent>
              </Card>
              <Card className="shadow-none">
                <CardHeader><CardTitle className="text-sm">Volumen por Cliente</CardTitle></CardHeader>
                <CardContent><VolumeBarChart data={analysis.volumeByCliente} /></CardContent>
              </Card>
            </div>

            {analysis.report1Groups.length === 0 ? (
              <Card className="shadow-none"><CardContent className="pt-6 text-sm text-muted-foreground">Sin clientes locales hoy ✓</CardContent></Card>
            ) : (
              <div className="flex flex-col gap-4">
                {analysis.report1Groups.map((g) => (
                  <div key={g.cp} className="rounded-lg border overflow-hidden">
                    <div className="flex items-center justify-between bg-muted px-3 py-2">
                      <span className="text-sm font-semibold text-foreground">
                        CP {g.cp} {g.localidad !== "—" && <span className="text-muted-foreground font-normal">· {g.localidad}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">Subtotal: {g.rows.length}</span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Waybill</TableHead>
                          <TableHead>Dirección</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Driver</TableHead>
                          <TableHead>Estado Actual</TableHead>
                          <TableHead>Cambio</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.rows.map((r) => (
                          <TableRow key={r.waybill}>
                            <TableCell className="whitespace-nowrap">{r.waybill}</TableCell>
                            <TableCell className="max-w-[260px] truncate" title={r.direccion}>{r.direccion || "—"}</TableCell>
                            <TableCell>{r.cliente || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.driver || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{ESTADO_LABEL[r.estado]}</TableCell>
                            <TableCell className="whitespace-nowrap">
                              <span className="px-1.5 py-0.5 text-[11px] rounded border bg-muted">{r.badgeLabel}</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* REPORTE 2 */}
          <TabsContent value="flow" className="flex flex-col gap-4 mt-4">
            <div className="flex items-center justify-end">
              <Button onClick={exportFlow} disabled={analysis.flow.length === 0} size="sm" className="gap-2">
                <Download className="size-3.5" /> Exportar a Excel
              </Button>
            </div>
            {analysis.flow.length === 0 ? (
              <Card className="shadow-none"><CardContent className="pt-6 text-sm text-muted-foreground">Sin clientes locales en el EPOD ✓</CardContent></Card>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-muted">
                    <tr>
                      <Th>CP</Th>
                      <Th>Localidad</Th>
                      <Th right>Total</Th>
                      <Th right>Entregados</Th>
                      <Th right>En Reparto</Th>
                      <Th right>Cancelados</Th>
                      <Th right>Fallos</Th>
                      <Th right>% Entrega</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.flow.map((f) => (
                      <tr key={f.cp} className="border-t border-border">
                        <Td className="whitespace-nowrap">{f.cp}</Td>
                        <Td>{f.localidad}</Td>
                        <Td right className="tabular-nums font-semibold">{f.total}</Td>
                        <Td right className="tabular-nums">{f.entregados}</Td>
                        <Td right className="tabular-nums">{f.enReparto}</Td>
                        <Td right className="tabular-nums">{f.cancelados}</Td>
                        <Td right className="tabular-nums">{f.fallos}</Td>
                        <Td right className="tabular-nums font-semibold">
                          <span style={{ color: pctEntregaColor(f.pctEntrega) }}>{f.pctEntrega.toFixed(1)}%</span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* REPORTE 4 */}
          <TabsContent value="shein-cd4" className="flex flex-col gap-4 mt-4">
            <CloseLoopSection
              windowDays={4}
              report={analysis.sheinCloseLoop}
              hasHistorico={!!historicoInfo}
              onExport={exportSheinCloseLoop}
            />
          </TabsContent>

          {/* REPORTE 5 */}
          <TabsContent value="local-cd5" className="flex flex-col gap-4 mt-4">
            <CloseLoopSection
              windowDays={5}
              report={analysis.localCloseLoop}
              hasHistorico={!!historicoInfo}
              onExport={exportLocalCloseLoop}
            />
          </TabsContent>

          {/* REPORTE 6 */}
          <TabsContent value="temu-cd5" className="flex flex-col gap-4 mt-4">
            <CloseLoopSection
              windowDays={5}
              report={analysis.temuCloseLoop}
              hasHistorico={!!historicoInfo}
              onExport={exportTemuCloseLoop}
            />
          </TabsContent>

          {/* REPORTE 7 */}
          <TabsContent value="aliexpress-cd5" className="flex flex-col gap-4 mt-4">
            <CloseLoopSection
              windowDays={5}
              report={analysis.aliexpressCloseLoop}
              hasHistorico={!!historicoInfo}
              onExport={exportAliexpressCloseLoop}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
