import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import XLSXStyle from "xlsx-js-style";
import {
  Upload,
  FileSpreadsheet,
  X,
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  Printer,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RequireAuth } from "@/components/RequireAuth";

export const Route = createFileRoute("/reportes_/super-reporte")({
  component: () => (
    <RequireAuth path="/reportes">
      <SuperReportePage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Súper Reporte" },
      {
        name: "description",
        content:
          "Entregas por categoría, CD5/CD13 y CD3 (intento de entrega) en un solo reporte.",
      },
    ],
  }),
});

const HUBS = [
  "Catalyx",
  "Montjuïc",
  "Luan Express",
  "Sendily",
  "Zerol",
  "Blackstork",
] as const;
type HubKey = (typeof HUBS)[number];

// ---------------------------------------------------------------------------
// Resolución de columnas (español / inglés)
// ---------------------------------------------------------------------------

const REQUIRED_ALIASES = {
  waybill: ["Número de Waybill", "Waybill Number"],
  fecha: ["Fecha de la tarea", "Task Date"],
  estado: ["Estado de la Tarea", "Task Status"],
  incidencia: ["Detalles de la Excepción", "Exception Detail"],
  cp: ["Código postal", "Zip Code"],
  ciudad: ["La ciudad de destino", "The destination city"],
  direccion: ["Dirección detallada", "Detailed address"],
  driver: ["Nombre del Repartidor", "Courier Name"],
} as const;
type RequiredField = keyof typeof REQUIRED_ALIASES;

// Estas dos no tienen equivalente en inglés conocido y son opcionales: si no
// existen en el archivo, la categorización simplemente cae en LOCAL (regla 6).
const OPTIONAL_ALIASES = {
  mercado: ["Nombre del mercado"],
  vendedor: ["Nombre del vendedor"],
} as const;
type OptionalField = keyof typeof OPTIONAL_ALIASES;

function resolveColumns(
  headers: string[],
):
  | {
      cols: Record<RequiredField, string>;
      optCols: Partial<Record<OptionalField, string>>;
      missing?: never;
    }
  | { cols?: never; optCols?: never; missing: string[] } {
  const cols = {} as Record<RequiredField, string>;
  const missing: string[] = [];
  for (const field of Object.keys(REQUIRED_ALIASES) as RequiredField[]) {
    const aliases = REQUIRED_ALIASES[field];
    const found = aliases.find((a) => headers.includes(a));
    if (found) cols[field] = found;
    else missing.push(aliases.join(" / "));
  }
  if (missing.length > 0) return { missing };

  const optCols: Partial<Record<OptionalField, string>> = {};
  for (const field of Object.keys(OPTIONAL_ALIASES) as OptionalField[]) {
    const aliases = OPTIONAL_ALIASES[field];
    const found = aliases.find((a) => headers.includes(a));
    if (found) optCols[field] = found;
  }
  return { cols, optCols };
}

// ---------------------------------------------------------------------------
// Clasificación de cliente
// ---------------------------------------------------------------------------

type Categoria = "LOCAL" | "TEMU" | "ALIEXPRESS";
const CATEGORIA_ORDER: Categoria[] = ["LOCAL", "TEMU", "ALIEXPRESS"];
const CATEGORIA_LABEL: Record<Categoria, string> = {
  LOCAL: "LOCAL",
  TEMU: "TEMU",
  ALIEXPRESS: "ALIEXPRESS / DROPSHIPPER CHINA",
};

const CHINESE_SURNAMES = new Set([
  "zhang", "wang", "li", "liu", "chen", "yang", "huang", "zhao", "wu", "zhou",
  "xu", "sun", "ma", "zhu", "hu", "guo", "he", "gao", "lin", "luo", "zheng",
  "liang", "song", "xie", "tang", "han", "cao", "deng", "feng", "yu", "dong",
  "xiao", "cai", "peng", "zeng", "qiu", "shen", "jiang", "yuan", "pan", "fan",
  "fang", "shi", "yao", "wei", "jia", "xiong", "kong", "lai", "bai", "long",
  "meng", "cui", "qin", "kang", "mao", "qiao", "gu", "shao", "wan", "duan",
  "lei", "tan", "wen", "chang", "zou", "yan", "liao", "ding", "xin", "yin",
  "ni", "ou", "ke", "chu", "guan", "zhan", "miao", "ai", "gong", "bao", "du",
  "dai", "ren", "jin", "qian", "lu", "tian",
]);

const EXACT_CHINA_CARRIERS = new Set(["yun express", "yanwen", "sf", "shunyou"]);

// Rango CJK Unified Ideographs (equivalente a /[一-鿿]/).
function hasCjk(s: string): boolean {
  return /[一-鿿]/.test(s);
}

/** empieza con, o contiene como palabra completa, un apellido chino en pinyin */
function matchesChineseSurname(raw: string): boolean {
  const lower = raw.toLowerCase();
  const compact = lower.replace(/[^a-z]/g, "");
  for (const surname of CHINESE_SURNAMES) {
    if (compact.startsWith(surname)) return true;
  }
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    if (CHINESE_SURNAMES.has(w)) return true;
  }
  return false;
}

function categorizeCliente(
  mercado: string,
  vendedor: string,
): { cliente: string; categoria: Categoria } {
  const cliente = mercado.trim() || vendedor.trim();
  if (!cliente) return { cliente: "", categoria: "LOCAL" };
  if (hasCjk(cliente)) return { cliente, categoria: "ALIEXPRESS" };
  if (matchesChineseSurname(cliente)) return { cliente, categoria: "ALIEXPRESS" };
  if (cliente.toLowerCase().includes("aliexpress")) return { cliente, categoria: "ALIEXPRESS" };
  if (EXACT_CHINA_CARRIERS.has(cliente.trim().toLowerCase())) return { cliente, categoria: "ALIEXPRESS" };
  if (cliente.toLowerCase().includes("temu")) return { cliente, categoria: "TEMU" };
  return { cliente, categoria: "LOCAL" };
}

// ---------------------------------------------------------------------------
// Estados: normalización, prioridad de dedup, e incidencia de dirección
// ---------------------------------------------------------------------------

function normalizeEstado(s: string): string {
  return s.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
function isDeliveredState(s: string): boolean {
  const n = normalizeEstado(s);
  return n === "entregado" || n === "delivered" || n === "return to seller success";
}
function isEnRepartoState(s: string): boolean {
  const n = normalizeEstado(s);
  return (
    n === "driver received" ||
    n === "driver received incidencias" ||
    n === "driver received incidence" ||
    n === "driver received incidencia"
  );
}
function isFailedState(s: string): boolean {
  const n = normalizeEstado(s);
  return n === "attempt failure" || n === "return to seller fail";
}
function isCancelarState(s: string): boolean {
  const n = normalizeEstado(s);
  return n === "cancelar" || n === "cancel" || n === "cancelled" || n === "canceled";
}
/** Prioridad de mejor a peor: menor número = mejor. Usada para desempatar el "estado final" del mismo día. */
function estadoPriority(s: string): number {
  if (isDeliveredState(s)) return 1;
  if (isEnRepartoState(s)) return 2;
  if (isFailedState(s)) return 3;
  if (isCancelarState(s)) return 4;
  return 5;
}

// Elimina diacríticos combinantes tras normalizar a NFD (rango U+0300–U+036F).
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
// Fechas
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tipos de fila / grupo / análisis
// ---------------------------------------------------------------------------

type RawRow = {
  waybill: string;
  fecha: Date | null;
  estado: string;
  incidencia: string;
  cp: string;
  ciudad: string;
  direccion: string;
  driver: string;
  cliente: string;
  categoria: Categoria;
  rowIndex: number;
};

type GroupInfo = {
  waybill: string;
  rows: RawRow[]; // ordenadas ascendente por fecha, luego rowIndex
  categoria: Categoria;
  cliente: string;
  inboundTs: number;
  estadoFinal: string;
  numIncidenciasTotal: number;
  ultimaIncidenciaTotal: string;
  cp: string;
  ciudad: string;
  direccion: string;
  driver: string;
};

function buildGroups(rows: RawRow[]): GroupInfo[] {
  const byWaybill = new Map<string, RawRow[]>();
  for (const r of rows) {
    if (!r.waybill) continue;
    const arr = byWaybill.get(r.waybill) ?? [];
    arr.push(r);
    byWaybill.set(r.waybill, arr);
  }

  const groups: GroupInfo[] = [];
  for (const [waybill, rs] of byWaybill) {
    const sorted = [...rs].sort((a, b) => {
      const at = a.fecha ? a.fecha.getTime() : 0;
      const bt = b.fecha ? b.fecha.getTime() : 0;
      if (at === bt) return a.rowIndex - b.rowIndex;
      return at - bt;
    });
    const sortedWithDate = sorted.filter((r): r is RawRow & { fecha: Date } => !!r.fecha);
    if (sortedWithDate.length === 0) continue;

    const inboundTs = dayStart(sortedWithDate[0].fecha);
    const lastDayTs = dayStart(sortedWithDate[sortedWithDate.length - 1].fecha);
    const onLastDay = sortedWithDate.filter((r) => dayStart(r.fecha) === lastDayTs);
    let bestRow = onLastDay[0];
    for (const r of onLastDay) {
      if (estadoPriority(r.estado) < estadoPriority(bestRow.estado)) bestRow = r;
    }

    const withInc = sorted.filter((r) => r.incidencia.trim() !== "");
    const last = sorted[sorted.length - 1];

    groups.push({
      waybill,
      rows: sorted,
      categoria: last.categoria,
      cliente: last.cliente,
      inboundTs,
      estadoFinal: bestRow.estado,
      numIncidenciasTotal: withInc.length,
      ultimaIncidenciaTotal: withInc.length > 0 ? withInc[withInc.length - 1].incidencia : "",
      cp: last.cp,
      ciudad: last.ciudad,
      direccion: last.direccion,
      driver: last.driver,
    });
  }
  return groups;
}

type CategoriaAgg = { categoria: Categoria; total: number; entregados: number };
type ClienteAgg = { cliente: string; total: number; entregados: number };

type CdCandidate = {
  waybill: string;
  categoria: Categoria;
  dias: number;
  numIncidencias: number;
  ultimaIncidencia: string;
  cp: string;
  ciudad: string;
  direccion: string;
  driver: string;
  estado: "EN_REPARTO" | "CANCELADA";
};

type Cd3Clase = "CON_INTENTO" | "SIN_INTENTO" | "AUN_EN_REPARTO" | null;
type Cd3Item = {
  waybill: string;
  categoria: Categoria;
  cp: string;
  ciudad: string;
  driver: string;
  clase: Cd3Clase;
};

type Analysis = {
  maxDate: Date | null;
  totalPaquetes: number;
  entregados: number;
  noEntregados: number;
  pctEntregados: number;
  porCategoria: CategoriaAgg[];
  topClientesLocal: ClienteAgg[];
  cd5: CdCandidate[];
  cd13: CdCandidate[];
  cd5PorCategoria: { categoria: Categoria; total: number }[];
  cd13PorCategoria: { categoria: Categoria; total: number }[];
  cd3Total: number;
  cd3ConIntento: number;
  cd3AunEnReparto: number;
  cd3SinIntento: number;
  cd3PorCategoria: { categoria: Categoria; total: number; conIntento: number }[];
  cd3AunEnRepartoDetalle: { waybill: string; categoria: Categoria; cp: string; ciudad: string; driver: string }[];
};

function analyze(rows: RawRow[]): Analysis | null {
  const withDate = rows.filter((r) => r.fecha);
  if (withDate.length === 0) return null;
  const maxTs = Math.max(...withDate.map((r) => dayStart(r.fecha!)));
  const maxDate = new Date(maxTs);

  const groups = buildGroups(rows);
  if (groups.length === 0) return null;

  // ---- SECCIÓN 1: Entregas por Categoría ----
  let totalPaquetes = 0;
  let entregados = 0;
  const catMap = new Map<Categoria, CategoriaAgg>();
  for (const c of CATEGORIA_ORDER) catMap.set(c, { categoria: c, total: 0, entregados: 0 });
  const clienteMap = new Map<string, ClienteAgg>();

  for (const g of groups) {
    totalPaquetes++;
    const delivered = isDeliveredState(g.estadoFinal);
    if (delivered) entregados++;
    const agg = catMap.get(g.categoria)!;
    agg.total++;
    if (delivered) agg.entregados++;
    if (g.categoria === "LOCAL") {
      const key = g.cliente || "— Sin cliente —";
      const cl = clienteMap.get(key) ?? { cliente: key, total: 0, entregados: 0 };
      cl.total++;
      if (delivered) cl.entregados++;
      clienteMap.set(key, cl);
    }
  }
  const noEntregados = totalPaquetes - entregados;
  const pctEntregados = totalPaquetes > 0 ? (entregados / totalPaquetes) * 100 : 0;
  const porCategoria = CATEGORIA_ORDER.map((c) => catMap.get(c)!);
  const topClientesLocal = Array.from(clienteMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  // ---- SECCIÓN 2: CD5 y CD13 ----
  const cdCandidates: CdCandidate[] = [];
  for (const g of groups) {
    const onToday = g.rows.filter((r) => r.fecha && dayStart(r.fecha) === maxTs);
    if (onToday.length === 0) continue;
    const lastToday = onToday[onToday.length - 1];
    let estado: "EN_REPARTO" | "CANCELADA" | null = null;
    if (isEnRepartoState(lastToday.estado)) estado = "EN_REPARTO";
    else if (isCancelarState(lastToday.estado)) estado = "CANCELADA";
    if (!estado) continue;
    if (isDireccionIncorrecta(g.ultimaIncidenciaTotal)) continue;

    const dias = Math.floor((maxTs - g.inboundTs) / 86400000);
    cdCandidates.push({
      waybill: g.waybill,
      categoria: g.categoria,
      dias,
      numIncidencias: g.numIncidenciasTotal,
      ultimaIncidencia: g.ultimaIncidenciaTotal || "Sin incidencias",
      cp: g.cp,
      ciudad: g.ciudad,
      direccion: g.direccion,
      driver: g.driver,
      estado,
    });
  }
  const cd5 = cdCandidates.filter((c) => c.dias > 5).sort((a, b) => b.dias - a.dias);
  const cd13 = cdCandidates.filter((c) => c.dias > 13).sort((a, b) => b.dias - a.dias);
  const cd5PorCategoria = CATEGORIA_ORDER.map((c) => ({
    categoria: c,
    total: cd5.filter((x) => x.categoria === c).length,
  }));
  const cd13PorCategoria = CATEGORIA_ORDER.map((c) => ({
    categoria: c,
    total: cd13.filter((x) => x.categoria === c).length,
  }));

  // ---- SECCIÓN 3: CD3 — Intento de Entrega ----
  const cohortTs = maxTs - 3 * 86400000;
  const cd3Items: Cd3Item[] = [];
  for (const g of groups) {
    if (g.inboundTs !== cohortTs) continue;
    let clase: Cd3Clase = null;
    if (isDeliveredState(g.estadoFinal) || isFailedState(g.estadoFinal)) clase = "CON_INTENTO";
    else if (isCancelarState(g.estadoFinal)) clase = "SIN_INTENTO";
    else if (isEnRepartoState(g.estadoFinal)) clase = "AUN_EN_REPARTO";
    cd3Items.push({
      waybill: g.waybill,
      categoria: g.categoria,
      cp: g.cp,
      ciudad: g.ciudad,
      driver: g.driver,
      clase,
    });
  }
  const cd3Total = cd3Items.length;
  const cd3ConIntento = cd3Items.filter((i) => i.clase === "CON_INTENTO").length;
  const cd3AunEnReparto = cd3Items.filter((i) => i.clase === "AUN_EN_REPARTO").length;
  const cd3SinIntento = cd3Items.filter((i) => i.clase === "SIN_INTENTO").length;
  const cd3PorCategoria = CATEGORIA_ORDER.map((c) => {
    const items = cd3Items.filter((i) => i.categoria === c);
    return {
      categoria: c,
      total: items.length,
      conIntento: items.filter((i) => i.clase === "CON_INTENTO").length,
    };
  });
  const cd3AunEnRepartoDetalle = cd3Items
    .filter((i) => i.clase === "AUN_EN_REPARTO")
    .map((i) => ({ waybill: i.waybill, categoria: i.categoria, cp: i.cp, ciudad: i.ciudad, driver: i.driver }));

  return {
    maxDate,
    totalPaquetes,
    entregados,
    noEntregados,
    pctEntregados,
    porCategoria,
    topClientesLocal,
    cd5,
    cd13,
    cd5PorCategoria,
    cd13PorCategoria,
    cd3Total,
    cd3ConIntento,
    cd3AunEnReparto,
    cd3SinIntento,
    cd3PorCategoria,
    cd3AunEnRepartoDetalle,
  };
}

// ---------------------------------------------------------------------------
// Colores / UI helpers
// ---------------------------------------------------------------------------

function pctColor(pct: number): string {
  if (pct >= 95) return "#16a34a";
  if (pct >= 85) return "#f59e0b";
  return "#dc2626";
}

function ProgressBar({ pct, className = "" }: { pct: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = pctColor(clamped);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 h-2 rounded-full bg-neutral-200 overflow-hidden print:border print:border-black">
        <div
          className="h-full rounded-full print:!bg-black"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[11px] tabular-nums w-10 text-right" style={{ color }}>
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}

function diasLevel(d: number): "critico" | "alto" | "medio" {
  if (d >= 10) return "critico";
  if (d >= 7) return "alto";
  return "medio";
}
function diasColors(level: "critico" | "alto" | "medio") {
  if (level === "critico") return { cell: "bg-destructive text-destructive-foreground", hex: "B91C1C", fontHex: "FFFFFF" };
  if (level === "alto") return { cell: "bg-rose-300 text-red-900", hex: "FDA4AF", fontHex: "7F1D1D" };
  return { cell: "bg-warn text-foreground", hex: "F59E0B", fontHex: "FFFFFF" };
}

function Kpi({
  label,
  value,
  sub,
  highlight,
  tone,
}: {
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
  tone?: "danger" | "warn";
}) {
  const base = "p-4 rounded-lg border print:border-black";
  const style = highlight
    ? "bg-primary/10 border-primary/25 text-foreground"
    : tone === "danger"
      ? "bg-destructive/10 border-destructive/25 text-destructive"
      : tone === "warn"
        ? "bg-warn/15 border-warn/40 text-foreground"
        : "bg-card text-foreground";
  return (
    <div className={`${base} ${style}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl md:text-3xl font-semibold tabular-nums">
        {typeof value === "number" ? value.toLocaleString("es-ES") : value}
      </div>
      {sub && <div className="mt-1 text-[11px] opacity-70">{sub}</div>}
    </div>
  );
}

function Th({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <th className={`px-3 py-2 text-[10px] uppercase tracking-wide ${right ? "text-right" : "text-left"} ${className}`}>
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-semibold tracking-tight relative transition-colors ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
      {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-electric" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------

function SectionCategoria({ analysis }: { analysis: Analysis }) {
  return (
    <>
      <section className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3 print:grid-cols-3">
        <Kpi label="Total paquetes" value={analysis.totalPaquetes} highlight />
        <Kpi label="Entregados" value={analysis.entregados} sub={`${analysis.pctEntregados.toFixed(1)}%`} />
        <Kpi
          label="No Entregados"
          value={analysis.noEntregados}
          sub={`${(100 - analysis.pctEntregados).toFixed(1)}%`}
          tone="danger"
        />
      </section>

      <section className="mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">
          % Entrega por Categoría
        </h3>
        <div className="overflow-x-auto rounded-lg border bg-card print:border-black">
          <table className="w-full text-[12px]">
            <thead className="bg-muted text-foreground">
              <tr>
                <Th>Categoría</Th>
                <Th right>Total</Th>
                <Th right>Entregados</Th>
                <Th className="w-[220px]">% Entrega</Th>
              </tr>
            </thead>
            <tbody>
              {analysis.porCategoria.map((c) => {
                const pct = c.total > 0 ? (c.entregados / c.total) * 100 : 0;
                return (
                  <tr key={c.categoria} className="border-t border-border">
                    <Td className="font-semibold">{CATEGORIA_LABEL[c.categoria]}</Td>
                    <Td right className="tabular-nums font-semibold">{c.total}</Td>
                    <Td right className="tabular-nums">{c.entregados}</Td>
                    <Td><ProgressBar pct={pct} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">
          Top Clientes LOCAL por Volumen
        </h3>
        {analysis.topClientesLocal.length === 0 ? (
          <div className="p-6 bg-card border rounded-lg text-sm text-foreground">
            Sin clientes LOCAL en el archivo.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card print:border-black">
            <table className="w-full text-[12px]">
              <thead className="bg-muted text-foreground">
                <tr>
                  <Th>Cliente</Th>
                  <Th right>Total</Th>
                  <Th right>Entregados</Th>
                  <Th className="w-[220px]">% Entrega</Th>
                </tr>
              </thead>
              <tbody>
                {analysis.topClientesLocal.map((c) => {
                  const pct = c.total > 0 ? (c.entregados / c.total) * 100 : 0;
                  return (
                    <tr key={c.cliente} className="border-t border-border">
                      <Td>{c.cliente}</Td>
                      <Td right className="tabular-nums font-semibold">{c.total}</Td>
                      <Td right className="tabular-nums">{c.entregados}</Td>
                      <Td><ProgressBar pct={pct} /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function CdBlock({
  title,
  detalle,
  porCategoria,
  onExport,
}: {
  title: string;
  detalle: CdCandidate[];
  porCategoria: { categoria: Categoria; total: number }[];
  onExport: () => void;
}) {
  return (
    <>
      <section className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="p-4 rounded-lg border border-primary/25 bg-primary/10 text-foreground inline-block">
          <div className="text-[11px] uppercase tracking-wide opacity-70">{title} — Total</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{detalle.length.toLocaleString("es-ES")}</div>
        </div>
        <Button onClick={onExport} disabled={detalle.length === 0} className="print:hidden gap-2">
          <Download className="size-3.5" /> Exportar a Excel
        </Button>
      </section>

      <section className="mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">{title} por Categoría</h3>
        <div className="overflow-x-auto rounded-lg border bg-card print:border-black">
          <table className="w-full text-[12px]">
            <thead className="bg-muted text-foreground">
              <tr><Th>Categoría</Th><Th right>Total</Th></tr>
            </thead>
            <tbody>
              {porCategoria.map((c) => (
                <tr key={c.categoria} className="border-t border-border">
                  <Td className="font-semibold">{CATEGORIA_LABEL[c.categoria]}</Td>
                  <Td right className="tabular-nums font-semibold">{c.total}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">Detalle {title}</h3>
        {detalle.length === 0 ? (
          <div className="p-6 bg-card border rounded-lg text-sm text-foreground">
            ✓ Sin paquetes en {title}
          </div>
        ) : (
          <div className="bg-card border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2.5">Waybill</th>
                  <th className="text-left px-3 py-2.5">Categoría</th>
                  <th className="text-center px-3 py-2.5">Días</th>
                  <th className="text-center px-3 py-2.5">N° Inc.</th>
                  <th className="text-left px-3 py-2.5">Última Incidencia</th>
                  <th className="text-left px-3 py-2.5">CP</th>
                  <th className="text-left px-3 py-2.5">Ciudad</th>
                  <th className="text-left px-3 py-2.5">Dirección</th>
                  <th className="text-left px-3 py-2.5">Driver</th>
                  <th className="text-left px-3 py-2.5">Estado</th>
                </tr>
              </thead>
              <tbody>
                {detalle.map((r) => {
                  const colors = diasColors(diasLevel(r.dias));
                  return (
                    <tr key={r.waybill} className="border-t border-border">
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.waybill}</td>
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">{CATEGORIA_LABEL[r.categoria]}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded font-semibold tabular-nums ${colors.cell}`}>
                          {r.dias}d
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-foreground tabular-nums">{r.numIncidencias}</td>
                      <td className="px-3 py-2 text-foreground max-w-[240px] truncate" title={r.ultimaIncidencia}>{r.ultimaIncidencia}</td>
                      <td className="px-3 py-2 text-foreground">{r.cp || "—"}</td>
                      <td className="px-3 py-2 text-foreground">{r.ciudad || "—"}</td>
                      <td className="px-3 py-2 text-foreground max-w-[240px] truncate" title={r.direccion}>{r.direccion || "—"}</td>
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.driver || "—"}</td>
                      <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.estado === "EN_REPARTO" ? "En Reparto" : "Cancelada"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function SectionCD({
  analysis,
  cdTab,
  setCdTab,
  onExport,
}: {
  analysis: Analysis;
  cdTab: "cd5" | "cd13";
  setCdTab: (t: "cd5" | "cd13") => void;
  onExport: (kind: "cd5" | "cd13") => void;
}) {
  return (
    <>
      <div className="print:hidden mb-4 flex items-center gap-2">
        <button
          onClick={() => setCdTab("cd5")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
            cdTab === "cd5" ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground hover:border-electric/50"
          }`}
        >
          CD5
        </button>
        <button
          onClick={() => setCdTab("cd13")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
            cdTab === "cd13" ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground hover:border-electric/50"
          }`}
        >
          CD13
        </button>
      </div>

      <div className={`${cdTab === "cd5" ? "block" : "hidden"} print:block`}>
        <CdBlock title="CD5" detalle={analysis.cd5} porCategoria={analysis.cd5PorCategoria} onExport={() => onExport("cd5")} />
      </div>
      <div className={`${cdTab === "cd13" ? "block" : "hidden"} print:block print:mt-8`}>
        <CdBlock title="CD13" detalle={analysis.cd13} porCategoria={analysis.cd13PorCategoria} onExport={() => onExport("cd13")} />
      </div>
    </>
  );
}

function SectionCD3({ analysis, onExport }: { analysis: Analysis; onExport: () => void }) {
  const pctConIntento = analysis.cd3Total > 0 ? (analysis.cd3ConIntento / analysis.cd3Total) * 100 : 0;
  const pctAunEnReparto = analysis.cd3Total > 0 ? (analysis.cd3AunEnReparto / analysis.cd3Total) * 100 : 0;
  const pctSinIntento = analysis.cd3Total > 0 ? (analysis.cd3SinIntento / analysis.cd3Total) * 100 : 0;
  return (
    <>
      <section className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3 print:grid-cols-4">
        <Kpi label="Total Cohorte" value={analysis.cd3Total} highlight />
        <Kpi label="Con Intento" value={analysis.cd3ConIntento} sub={`${pctConIntento.toFixed(1)}%`} />
        <Kpi
          label="Aún en Reparto"
          value={analysis.cd3AunEnReparto}
          sub={`${pctAunEnReparto.toFixed(1)}%`}
          tone={analysis.cd3AunEnReparto > 0 ? "warn" : undefined}
        />
        <Kpi label="Sin Intento" value={analysis.cd3SinIntento} sub={`${pctSinIntento.toFixed(1)}%`} tone="danger" />
      </section>

      <section className="mb-6 p-4 rounded-lg border bg-card print:border-black text-[12px] text-foreground space-y-1.5">
        <p><strong>Con Intento:</strong> entregado o con intento fallido de entrega (Entregado/Delivered/Return_to_seller_success o Attempt Failure/Return_to_seller_fail).</p>
        <p><strong>Aún en Reparto:</strong> el paquete sigue en curso, sin intento registrado (Driver_received/Driver received incidence).</p>
        <p><strong>Sin Intento:</strong> cancelado antes de intentar la entrega (Cancelar).</p>
      </section>

      <section className="mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">% Con Intento por Categoría</h3>
        <div className="overflow-x-auto rounded-lg border bg-card print:border-black">
          <table className="w-full text-[12px]">
            <thead className="bg-muted text-foreground">
              <tr>
                <Th>Categoría</Th>
                <Th right>Total</Th>
                <Th right>Con Intento</Th>
                <Th className="w-[220px]">% Con Intento</Th>
              </tr>
            </thead>
            <tbody>
              {analysis.cd3PorCategoria.map((c) => {
                const pct = c.total > 0 ? (c.conIntento / c.total) * 100 : 0;
                return (
                  <tr key={c.categoria} className="border-t border-border">
                    <Td className="font-semibold">{CATEGORIA_LABEL[c.categoria]}</Td>
                    <Td right className="tabular-nums font-semibold">{c.total}</Td>
                    <Td right className="tabular-nums">{c.conIntento}</Td>
                    <Td><ProgressBar pct={pct} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Detalle — Aún en Reparto</h3>
          <Button onClick={onExport} disabled={analysis.cd3AunEnRepartoDetalle.length === 0} className="print:hidden gap-2">
            <Download className="size-3.5" /> Exportar a Excel
          </Button>
        </div>
        {analysis.cd3AunEnRepartoDetalle.length === 0 ? (
          <div className="p-6 bg-card border rounded-lg text-sm text-foreground">
            ✓ Sin paquetes aún en reparto
          </div>
        ) : (
          <div className="bg-card border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2.5">Waybill</th>
                  <th className="text-left px-3 py-2.5">Categoría</th>
                  <th className="text-left px-3 py-2.5">CP</th>
                  <th className="text-left px-3 py-2.5">Ciudad</th>
                  <th className="text-left px-3 py-2.5">Driver</th>
                </tr>
              </thead>
              <tbody>
                {analysis.cd3AunEnRepartoDetalle.map((r) => (
                  <tr key={r.waybill} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.waybill}</td>
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">{CATEGORIA_LABEL[r.categoria]}</td>
                    <td className="px-3 py-2 text-foreground">{r.cp || "—"}</td>
                    <td className="px-3 py-2 text-foreground">{r.ciudad || "—"}</td>
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.driver || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Excel export (mismo patrón que paquetes-en-riesgo.tsx)
// ---------------------------------------------------------------------------

type WorkSheetLike = ReturnType<typeof XLSXStyle.utils.aoa_to_sheet>;

function styleHeaderRow(ws: WorkSheetLike, colCount: number) {
  const headerStyle = {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "111111" } },
    alignment: { horizontal: "center", vertical: "center" },
  };
  for (let c = 0; c < colCount; c++) {
    const ref = XLSXStyle.utils.encode_cell({ r: 0, c });
    const cell = (ws as Record<string, unknown>)[ref] as { s?: unknown } | undefined;
    if (cell) cell.s = headerStyle;
  }
}

function downloadWorkbook(ws: WorkSheetLike, sheetName: string, filename: string) {
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSXStyle.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function SuperReportePage() {
  const [hub, setHub] = useState<HubKey | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<"categoria" | "cd" | "cd3">("categoria");
  const [cdTab, setCdTab] = useState<"cd5" | "cd13">("cd5");

  const analysis = useMemo(() => (rows ? analyze(rows) : null), [rows]);

  const handleFile = async (f: File | null) => {
    setFile(f);
    setRows(null);
    setError(null);
    if (!f) return;
    if (!hub) {
      setError("Selecciona un hub antes de subir el archivo.");
      setFile(null);
      return;
    }
    setLoading(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("El archivo no tiene hojas.");
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: "",
        raw: true,
      });
      if (json.length === 0) throw new Error("El archivo está vacío.");
      const headers = Object.keys(json[0]);
      const resolved = resolveColumns(headers);
      if (resolved.missing) {
        throw new Error(
          `Faltan columnas: ${resolved.missing.join(", ")}. Verifica el formato del archivo (se aceptan EPOD en español o en inglés).`,
        );
      }
      const cols = resolved.cols;
      const optCols = resolved.optCols;
      const parsed: RawRow[] = json.map((r, i) => {
        const mercado = optCols.mercado ? String(r[optCols.mercado] ?? "").trim() : "";
        const vendedor = optCols.vendedor ? String(r[optCols.vendedor] ?? "").trim() : "";
        const { cliente, categoria } = categorizeCliente(mercado, vendedor);
        return {
          waybill: String(r[cols.waybill] ?? "").trim(),
          fecha: parseFecha(r[cols.fecha]),
          estado: String(r[cols.estado] ?? "").trim(),
          incidencia: String(r[cols.incidencia] ?? "").trim(),
          cp: String(r[cols.cp] ?? "").trim(),
          ciudad: String(r[cols.ciudad] ?? "").trim(),
          direccion: String(r[cols.direccion] ?? "").trim(),
          driver: String(r[cols.driver] ?? "").trim(),
          cliente,
          categoria,
          rowIndex: i,
        };
      });
      setRows(parsed);

      const a = analyze(parsed);
      if (hub && a) {
        try {
          const key = "super_reporte_v1";
          const store = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
          store[hub] = {
            fecha: formatDate(a.maxDate),
            totalPaquetes: a.totalPaquetes,
            pctEntregados: Number(a.pctEntregados.toFixed(2)),
            cd5Total: a.cd5.length,
            cd13Total: a.cd13.length,
            cd3Total: a.cd3Total,
            cd3ConIntentoPct: a.cd3Total > 0 ? Number(((a.cd3ConIntento / a.cd3Total) * 100).toFixed(2)) : 0,
            updatedAt: new Date().toISOString(),
          };
          localStorage.setItem(key, JSON.stringify(store));
        } catch { /* ignore */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error leyendo el archivo.");
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const exportCdExcel = (kind: "cd5" | "cd13") => {
    if (!analysis) return;
    const detalle = kind === "cd5" ? analysis.cd5 : analysis.cd13;
    if (detalle.length === 0) return;
    const headers = ["Waybill", "Categoría", "Días", "N° Incidencias", "Última Incidencia", "CP", "Ciudad", "Dirección", "Driver", "Estado"];
    const aoa: (string | number)[][] = [headers];
    for (const r of detalle) {
      aoa.push([
        r.waybill,
        CATEGORIA_LABEL[r.categoria],
        r.dias,
        r.numIncidencias,
        r.ultimaIncidencia,
        r.cp,
        r.ciudad,
        r.direccion,
        r.driver,
        r.estado === "EN_REPARTO" ? "En Reparto" : "Cancelada",
      ]);
    }
    const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
    styleHeaderRow(ws, headers.length);
    for (let i = 0; i < detalle.length; i++) {
      const { hex, fontHex } = diasColors(diasLevel(detalle[i].dias));
      const ref = XLSXStyle.utils.encode_cell({ r: i + 1, c: 2 });
      const cell = (ws as Record<string, unknown>)[ref] as { s?: unknown } | undefined;
      if (cell) {
        cell.s = {
          font: { bold: true, color: { rgb: fontHex } },
          fill: { patternType: "solid", fgColor: { rgb: hex } },
          alignment: { horizontal: "center" },
        };
      }
    }
    ws["!cols"] = [
      { wch: 22 }, { wch: 24 }, { wch: 8 }, { wch: 14 }, { wch: 32 },
      { wch: 8 }, { wch: 18 }, { wch: 36 }, { wch: 22 }, { wch: 14 },
    ];
    downloadWorkbook(ws, kind.toUpperCase(), `${kind}_${hub}_${formatDate(analysis.maxDate)}.xlsx`);
  };

  const exportCd3Excel = () => {
    if (!analysis || analysis.cd3AunEnRepartoDetalle.length === 0) return;
    const headers = ["Waybill", "Categoría", "CP", "Ciudad", "Driver"];
    const aoa: (string | number)[][] = [headers];
    for (const r of analysis.cd3AunEnRepartoDetalle) {
      aoa.push([r.waybill, CATEGORIA_LABEL[r.categoria], r.cp, r.ciudad, r.driver]);
    }
    const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
    styleHeaderRow(ws, headers.length);
    ws["!cols"] = [{ wch: 22 }, { wch: 24 }, { wch: 8 }, { wch: 18 }, { wch: 22 }];
    downloadWorkbook(ws, "CD3", `cd3_intento_entrega_${hub}_${formatDate(analysis.maxDate)}.xlsx`);
  };

  return (
    <div className="flex flex-col gap-6 print:bg-white">
      <div className="print:px-6 print:py-4">
        <div className="mb-4 print:hidden">
          <Link
            to="/reportes"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Volver a Reportes
          </Link>
        </div>

        <header className="mb-6 print:mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight print:text-xl">
              Súper Reporte
            </h1>
            <p className="mt-1 text-sm text-muted-foreground print:text-xs">
              Entregas por categoría, CD5/CD13 y CD3 (intento de entrega).
              {analysis && (
                <>
                  {" "}Hub <strong>{hub}</strong> · Fecha <strong>{formatDate(analysis.maxDate)}</strong>
                </>
              )}
            </p>
          </div>
          {analysis && (
            <Button onClick={() => window.print()} className="print:hidden gap-2">
              <Printer className="size-3.5" /> Exportar a PDF
            </Button>
          )}
        </header>

        {/* Hub selector + Dropzone (hidden in print) */}
        <div className="print:hidden">
            <section className="mb-4">
              <label className="text-[11px] uppercase text-muted-foreground tracking-wide">Hub</label>
              <div className="mt-1 relative w-full max-w-xs">
                <select
                  value={hub}
                  onChange={(e) => {
                    setHub(e.target.value as HubKey | "");
                    void handleFile(null);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                  className="w-full appearance-none pl-3 pr-8 py-2 text-sm bg-card border rounded-md text-foreground"
                >
                  <option value="">— Selecciona hub —</option>
                  {HUBS.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              </div>
            </section>

            <section className="mb-6">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleFile(f);
                }}
                onClick={() => hub && inputRef.current?.click()}
                className={`p-5 bg-card border-2 border-dashed rounded-lg transition-colors ${
                  !hub
                    ? "border-border opacity-60 cursor-not-allowed"
                    : dragOver
                      ? "border-electric bg-electric/5 cursor-pointer"
                      : "border-border hover:border-electric/50 cursor-pointer"
                }`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="size-6 text-electric shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{file.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                        {rows ? ` · ${rows.length} filas` : ""}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleFile(null);
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
                    <Upload className="size-6 text-electric" />
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {hub ? `Sube el Excel EPOD de ${hub}` : "Primero selecciona un hub"}
                      </div>
                      <div className="text-[11px]">.xlsx · Arrastra aquí o haz click</div>
                    </div>
                  </div>
                )}
              </div>
              {loading && (
                <p className="mt-2 text-[12px] text-muted-foreground">Procesando…</p>
              )}
              {error && (
                <p className="mt-2 text-destructive text-[12px] flex items-start gap-1.5">
                  <AlertCircle className="size-3 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </p>
              )}
            </section>
          </div>

          {analysis && (
            <>
              <div className="print:hidden mb-6 flex items-center gap-1 border-b border-border flex-wrap">
                <TabButton active={section === "categoria"} onClick={() => setSection("categoria")}>
                  Entregas por Categoría
                </TabButton>
                <TabButton active={section === "cd"} onClick={() => setSection("cd")}>
                  CD5 y CD13
                </TabButton>
                <TabButton active={section === "cd3"} onClick={() => setSection("cd3")}>
                  CD3 — Intento de Entrega
                </TabButton>
              </div>

              <div className={`${section === "categoria" ? "block" : "hidden"} print:block`}>
                <SectionCategoria analysis={analysis} />
              </div>

              <div className={`${section === "cd" ? "block" : "hidden"} print:block print:break-before-page`}>
                <SectionCD analysis={analysis} cdTab={cdTab} setCdTab={setCdTab} onExport={exportCdExcel} />
              </div>

              <div className={`${section === "cd3" ? "block" : "hidden"} print:block print:break-before-page`}>
                <SectionCD3 analysis={analysis} onExport={exportCd3Excel} />
              </div>
            </>
          )}
        </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:break-before-page { break-before: page; }
        }
      `}</style>
    </div>
  );
}
