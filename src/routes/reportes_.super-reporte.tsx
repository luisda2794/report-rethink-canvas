import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RequireAuth } from "@/components/RequireAuth";
import { HubCombobox } from "@/components/HubCombobox";
import { resolveEventDate } from "@/lib/resolve-event-date";
import { getAllHubs, getEpodData, requireFields, type EpodField } from "@/lib/epodStore";
import { getClientesLocalesConfig, isSheinClient, applyClientAlias, type ClientesLocalesConfig } from "@/lib/clientes-locales-config";

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
        content: "Entregas por categoría (LOCAL/TEMU/ALIEXPRESS/SHEIN) y top clientes locales por volumen.",
      },
    ],
  }),
});

const REQUIRED_FIELDS: EpodField[] = ["waybill", "fecha", "estado", "incidencia", "cp", "ciudad", "direccion", "driver"];

// ---------------------------------------------------------------------------
// Clasificación de cliente
// ---------------------------------------------------------------------------

type Categoria = "LOCAL" | "TEMU" | "ALIEXPRESS" | "SHEIN";
const CATEGORIA_ORDER: Categoria[] = ["LOCAL", "TEMU", "ALIEXPRESS", "SHEIN"];
const CATEGORIA_LABEL: Record<Categoria, string> = {
  LOCAL: "LOCAL",
  TEMU: "TEMU",
  ALIEXPRESS: "ALIEXPRESS / DROPSHIPPER CHINA",
  SHEIN: "SHEIN",
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
  config: ClientesLocalesConfig,
): { cliente: string; categoria: Categoria } {
  const mercadoTrim = mercado.trim();
  const vendedorTrim = vendedor.trim();
  const clienteRaw = mercadoTrim || vendedorTrim;
  if (!clienteRaw) return { cliente: "", categoria: "LOCAL" };

  // Prioridad: alias configurable (p.ej. INFINITE REMIT -> SHEIN) sobre cualquier
  // otra regla de clasificación.
  if (isSheinClient(mercadoTrim, vendedorTrim, config)) {
    return { cliente: "SHEIN", categoria: "SHEIN" };
  }

  const cliente = applyClientAlias(clienteRaw, config);
  if (hasCjk(clienteRaw)) return { cliente, categoria: "ALIEXPRESS" };
  if (matchesChineseSurname(clienteRaw)) return { cliente, categoria: "ALIEXPRESS" };
  if (clienteRaw.toLowerCase().includes("aliexpress")) return { cliente, categoria: "ALIEXPRESS" };
  if (EXACT_CHINA_CARRIERS.has(clienteRaw.toLowerCase())) return { cliente, categoria: "ALIEXPRESS" };
  if (clienteRaw.toLowerCase().includes("temu")) return { cliente, categoria: "TEMU" };
  return { cliente, categoria: "LOCAL" };
}

// ---------------------------------------------------------------------------
// Estados: normalización y prioridad de dedup
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

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

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

type Analysis = {
  maxDate: Date | null;
  totalPaquetes: number;
  entregados: number;
  noEntregados: number;
  pctEntregados: number;
  porCategoria: CategoriaAgg[];
  topClientesLocal: ClienteAgg[];
};

function analyze(rows: RawRow[]): Analysis | null {
  const withDate = rows.filter((r) => r.fecha);
  if (withDate.length === 0) return null;
  const maxTs = Math.max(...withDate.map((r) => dayStart(r.fecha!)));
  const maxDate = new Date(maxTs);

  const groups = buildGroups(rows);
  if (groups.length === 0) return null;

  // ---- Entregas por Categoría ----
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

  return {
    maxDate,
    totalPaquetes,
    entregados,
    noEntregados,
    pctEntregados,
    porCategoria,
    topClientesLocal,
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

// ---------------------------------------------------------------------------
// Sección
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

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function SuperReportePage() {
  const [hub, setHub] = useState("");
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasAnyHub, setHasAnyHub] = useState<boolean | null>(null);

  const analysis = useMemo(() => (rows ? analyze(rows) : null), [rows]);

  useEffect(() => {
    getAllHubs()
      .then((list) => setHasAnyHub(list.length > 0))
      .catch(() => setHasAnyHub(false));
  }, []);

  useEffect(() => {
    if (!hub.trim()) {
      setRows(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEpodData(hub.trim())
      .then((record) => {
        if (cancelled) return;
        if (!record) {
          setRows(null);
          setError(`No hay datos cargados para "${hub.trim()}".`);
          return;
        }
        requireFields(record.metadata.detectedFields, REQUIRED_FIELDS);
        const clientesConfig = getClientesLocalesConfig();
        const parsed: RawRow[] = record.rows.map((r) => {
          const { cliente, categoria } = categorizeCliente(r.mercado, r.vendedor, clientesConfig);
          const fecha = resolveEventDate({
            estado: r.estado,
            fechaTarea: r.fecha ? new Date(r.fecha) : null,
            tiempoEntrega: r.tiempoEntrega ? new Date(r.tiempoEntrega) : null,
            tiempoFracaso: r.tiempoFracaso ? new Date(r.tiempoFracaso) : null,
          });
          return {
            waybill: r.waybill,
            fecha,
            estado: r.estado,
            incidencia: r.incidencia,
            cp: r.cp,
            ciudad: r.ciudad,
            direccion: r.direccion,
            driver: r.driver,
            cliente,
            categoria,
            rowIndex: r.rowIndex,
          };
        });
        setRows(parsed);

        const a = analyze(parsed);
        if (a) {
          try {
            const key = "super_reporte_v1";
            const store = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
            store[hub.trim()] = {
              fecha: formatDate(a.maxDate),
              totalPaquetes: a.totalPaquetes,
              pctEntregados: Number(a.pctEntregados.toFixed(2)),
              updatedAt: new Date().toISOString(),
            };
            localStorage.setItem(key, JSON.stringify(store));
          } catch { /* ignore */ }
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setRows(null);
        setError(e instanceof Error ? e.message : "Error cargando los datos del hub.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hub]);

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
              Entregas por categoría (LOCAL/TEMU/ALIEXPRESS/SHEIN) y top clientes locales por volumen.
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

        {/* Hub selector (hidden in print) */}
        <div className="print:hidden">
            <section className="mb-6">
              <label className="text-[11px] uppercase text-muted-foreground tracking-wide">Hub</label>
              <div className="mt-1">
                <HubCombobox value={hub} onChange={setHub} className="max-w-xs" />
              </div>
              {loading && (
                <p className="mt-2 text-[12px] text-muted-foreground">Cargando datos del hub…</p>
              )}
              {error && (
                <p className="mt-2 text-destructive text-[12px] flex items-start gap-1.5">
                  <AlertCircle className="size-3 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </p>
              )}
              {hasAnyHub === false && (
                <p className="mt-2 text-sm text-muted-foreground flex items-center gap-2">
                  No hay datos cargados. Ve a la sección ePOD para subir el archivo de un hub.
                  <Link to="/epod" className="inline-flex items-center gap-1 text-primary hover:underline">
                    Ir a ePOD <ArrowRight className="size-3.5" />
                  </Link>
                </p>
              )}
            </section>
          </div>

          {analysis && <SectionCategoria analysis={analysis} />}
        </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
