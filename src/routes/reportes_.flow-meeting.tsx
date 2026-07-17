import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FileSpreadsheet,
  X,
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  Printer,
  Package,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";

export const Route = createFileRoute("/reportes_/flow-meeting")({
  component: () => (
    <RequireAuth path="/reportes">
      <FlowMeetingPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Flow Meeting" },
      {
        name: "description",
        content:
          "Dashboard de reunión de flujo: KPIs del día por driver, CP e incidencias.",
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

const COLUMN_ALIASES = {
  waybill: ["Número de Waybill", "Waybill Number"],
  fecha: ["Fecha de la tarea", "Task Date"],
  estado: ["Estado de la Tarea", "Task Status"],
  incidencia: ["Detalles de la Excepción", "Exception Detail"],
  cp: ["Código postal", "Zip Code"],
  driver: ["Nombre del Repartidor", "Courier Name"],
  tipoEntrega: ["Tipo de Entrega", "Delivery Type"],
} as const;

type ColumnField = keyof typeof COLUMN_ALIASES;

function resolveColumns(
  headers: string[],
): { cols: Record<ColumnField, string>; missing?: never } | { cols?: never; missing: string[] } {
  const cols = {} as Record<ColumnField, string>;
  const missing: string[] = [];
  for (const field of Object.keys(COLUMN_ALIASES) as ColumnField[]) {
    const aliases = COLUMN_ALIASES[field];
    const found = aliases.find((a) => headers.includes(a));
    if (found) {
      cols[field] = found;
    } else {
      missing.push(aliases.join(" / "));
    }
  }
  return missing.length > 0 ? { missing } : { cols };
}

type Categoria = "COMPLETADO" | "DEVOLUCION" | "EN_REPARTO" | "FALLO" | "OTRO";

type RawRow = {
  waybill: string;
  fecha: Date | null;
  estado: string;
  categoria: Categoria;
  incidencia: string;
  cp: string;
  driver: string;
  tipoEntrega: string;
  rowIndex: number;
};

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

function categorizar(estadoRaw: string): Categoria {
  const s = estadoRaw.trim().toLowerCase();
  if (s === "entregado" || s === "delivered") return "COMPLETADO";
  if (s === "return_to_seller_success") return "DEVOLUCION";
  if (s === "driver_received" || s === "driver_received_incidencias") return "EN_REPARTO";
  if (s === "attempt failure" || s === "return_to_seller_fail") return "FALLO";
  return "OTRO";
}

type DriverAgg = {
  driver: string;
  total: number;
  entregado: number;
  devolucion: number;
  enReparto: number;
  fallos: number;
  otros: number;
};

type CpAgg = {
  driver: string;
  cp: string;
  total: number;
  completado: number;
  enReparto: number;
  fallos: number;
};

type Analysis = {
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

function pctColor(pct: number): string {
  if (pct >= 85) return "#16a34a";
  if (pct >= 70) return "#f59e0b";
  return "#dc2626";
}

function analyze(rows: RawRow[]): Analysis {
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
      <span className="text-[11px] font-mono tabular-nums w-10 text-right" style={{ color }}>
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}

function IncBar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex-1 h-2 rounded-full bg-neutral-200 overflow-hidden">
      <div className="h-full bg-ink rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

function FlowMeetingPage() {
  const [hub, setHub] = useState<HubKey | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
      const parsed: RawRow[] = json.map((r, i) => {
        const estado = String(r[cols.estado] ?? "").trim();
        return {
          waybill: String(r[cols.waybill] ?? "").trim(),
          fecha: parseFecha(r[cols.fecha]),
          estado,
          categoria: categorizar(estado),
          incidencia: String(r[cols.incidencia] ?? "").trim(),
          cp: String(r[cols.cp] ?? "").trim(),
          driver: String(r[cols.driver] ?? "").trim(),
          tipoEntrega: String(r[cols.tipoEntrega] ?? "").trim(),
          rowIndex: i,
        };
      });
      setRows(parsed);
      const a = analyze(parsed);
      if (hub && a.maxDate) {
        try {
          const key = "flow_meeting_v1";
          const store = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<
            string,
            { fecha: string; total: number; pctCompletado: number; pendientes: number; updatedAt: string }
          >;
          store[hub] = {
            fecha: formatDate(a.maxDate),
            total: a.totalDia,
            pctCompletado: Number(a.pctCompletado.toFixed(2)),
            pendientes: a.enReparto,
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

  const showFullCp = analysis ? analysis.cpsCount <= 15 : false;
  const cpsToShow = analysis
    ? showFullCp
      ? analysis.cps
      : analysis.cps.filter((c) => c.enReparto > 0)
    : [];

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col print:bg-white">
      <div className="print:hidden">
        <Topbar section="Reportes" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-10 lg:py-14 print:px-6 print:py-4">
        <div className="max-w-7xl mx-auto">
          <div className="mb-4 print:hidden">
            <Link
              to="/reportes"
              className="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted-text hover:text-ink"
            >
              <ArrowLeft className="size-3" /> Volver a Reportes
            </Link>
          </div>

          <header className="mb-8 print:mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground print:text-xl">
                FLOW MEETING
              </h1>
              <p className="mt-2 text-sm text-muted-foreground print:text-xs">
                Dashboard de la <span className="italic font-serif">reunión de flujo</span> — foto del día operativo.
                {analysis && (
                  <>
                    {" "}Hub <strong>{hub}</strong> · Fecha <strong>{formatDate(analysis.maxDate)}</strong>
                  </>
                )}
              </p>
            </div>
            {analysis && (
              <button
                onClick={() => window.print()}
                className="print:hidden inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold font-syne rounded-md bg-ink text-white hover:bg-ink/90"
              >
                <Printer className="size-3.5" /> Exportar a PDF
              </button>
            )}
          </header>

          {/* Hub selector + Dropzone (hidden in print) */}
          <div className="print:hidden">
            <section className="mb-4">
              <label className="text-[11px] font-mono uppercase text-muted-text tracking-wide">Hub</label>
              <div className="mt-1 relative w-full max-w-xs">
                <select
                  value={hub}
                  onChange={(e) => {
                    setHub(e.target.value as HubKey | "");
                    void handleFile(null);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                  className="w-full appearance-none pl-3 pr-8 py-2 text-sm bg-surface border border-hairline rounded-md text-ink font-syne"
                >
                  <option value="">— Selecciona hub —</option>
                  {HUBS.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-text" />
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
                className={`p-5 bg-surface border-2 border-dashed rounded-lg transition-colors ${
                  !hub
                    ? "border-hairline opacity-60 cursor-not-allowed"
                    : dragOver
                      ? "border-electric bg-electric/5 cursor-pointer"
                      : "border-hairline hover:border-electric/50 cursor-pointer"
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
                      <div className="text-sm font-semibold text-ink truncate">{file.name}</div>
                      <div className="text-[11px] text-muted-text font-mono">
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
                      className="p-1.5 rounded hover:bg-surface-2 text-muted-text hover:text-ink"
                      aria-label="Quitar archivo"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-muted-text">
                    <Upload className="size-6 text-electric" />
                    <div>
                      <div className="text-sm font-semibold text-ink">
                        {hub ? `Sube el Excel EPOD de ${hub}` : "Primero selecciona un hub"}
                      </div>
                      <div className="text-[11px] font-mono">.xlsx · Arrastra aquí o haz click</div>
                    </div>
                  </div>
                )}
              </div>
              {loading && (
                <p className="mt-2 text-[12px] font-mono text-muted-text">Procesando…</p>
              )}
              {error && (
                <p className="mt-2 text-danger text-[12px] font-mono flex items-start gap-1.5">
                  <AlertCircle className="size-3 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </p>
              )}
            </section>
          </div>

          {analysis && (
            <>
              {/* KPIs */}
              <section className="mb-6 grid grid-cols-2 md:grid-cols-5 gap-3 print:grid-cols-5 print:gap-2">
                <Kpi label="Total del día" value={analysis.totalDia} highlight />
                <Kpi
                  label="Completados"
                  value={analysis.completados + analysis.devoluciones}
                  sub={`${analysis.pctCompletado.toFixed(1)}%`}
                />
                <Kpi label="En reparto" value={analysis.enReparto} />
                <Kpi label="Fallos" value={analysis.fallos} tone="danger" />
                <Kpi
                  label="PUDOs pendientes"
                  value={analysis.pudoPendientes}
                  tone={analysis.pudoPendientes > 0 ? "warn" : undefined}
                />
              </section>

              {/* PUDOs card */}
              {analysis.pudoTotal > 0 && (
                <section className="mb-6 p-4 rounded-lg border border-hairline bg-surface print:border-black">
                  <div className="flex items-center gap-2 mb-3">
                    <Package className="size-4 text-electric" />
                    <h3 className="text-sm font-semibold text-ink">PUDOs del día</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                    <div>
                      <div className="text-[11px] font-mono uppercase text-muted-text">Total PUDO</div>
                      <div className="text-2xl font-semibold tabular-nums">{analysis.pudoTotal}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-mono uppercase text-muted-text">Entregados</div>
                      <div className="text-2xl font-semibold tabular-nums">{analysis.pudoEntregados}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-mono uppercase text-muted-text mb-1">% Entrega PUDO</div>
                      <ProgressBar
                        pct={analysis.pudoTotal > 0 ? (analysis.pudoEntregados / analysis.pudoTotal) * 100 : 0}
                      />
                    </div>
                  </div>
                  {analysis.pudoPendientes > 0 && (
                    <div className="mt-3 p-2.5 rounded bg-[#F5E100] text-ink text-[13px] font-semibold border-2 border-ink">
                      ⚠ {analysis.pudoPendientes} PUDO{analysis.pudoPendientes === 1 ? "" : "s"} pendiente{analysis.pudoPendientes === 1 ? "" : "s"} por entregar
                    </div>
                  )}
                </section>
              )}

              {/* Drivers */}
              <section className="mb-6 print:break-before-page">
                <h3 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">
                  Resumen por Driver
                </h3>
                <div className="overflow-x-auto rounded-lg border border-hairline bg-surface print:border-black">
                  <table className="w-full text-[12px]">
                    <thead className="bg-ink text-white print:bg-black">
                      <tr>
                        <Th>Driver</Th>
                        <Th right>Total</Th>
                        <Th right>Entreg.</Th>
                        <Th right>Devol.</Th>
                        <Th className="w-[220px]">% Completado</Th>
                        <Th right>En Reparto</Th>
                        <Th right>Fallos</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.drivers.map((d) => {
                        const base = d.entregado + d.devolucion + d.enReparto + d.fallos;
                        const pct = base > 0 ? ((d.entregado + d.devolucion) / base) * 100 : 0;
                        return (
                          <tr key={d.driver} className="border-t border-hairline">
                            <Td className="font-mono">{d.driver}</Td>
                            <Td right className="tabular-nums font-semibold">{d.total}</Td>
                            <Td right className="tabular-nums">{d.entregado}</Td>
                            <Td right className="tabular-nums">{d.devolucion}</Td>
                            <Td><ProgressBar pct={pct} /></Td>
                            <Td right className="tabular-nums">{d.enReparto}</Td>
                            <Td right className={`tabular-nums ${d.fallos > 0 ? "text-danger font-semibold" : ""}`}>{d.fallos}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* CPs */}
              <section className="mb-6 print:break-before-page">
                <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                  <h3 className="text-sm font-semibold text-ink uppercase tracking-wide">
                    {showFullCp ? "Detalle por CP" : "Puntos Críticos por CP"}
                  </h3>
                  <span className="text-[11px] font-mono text-muted-text">
                    {analysis.cpsCount} CPs · {showFullCp ? "vista completa" : `mostrando ${cpsToShow.length} combinaciones con paquetes en reparto`}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-hairline bg-surface print:border-black">
                  <table className="w-full text-[12px]">
                    <thead className="bg-ink text-white print:bg-black">
                      <tr>
                        <Th>Driver</Th>
                        <Th>CP</Th>
                        <Th right>Total</Th>
                        <Th right>Compl.</Th>
                        <Th className="w-[220px]">% Completado</Th>
                        <Th right>En Reparto</Th>
                        <Th right>Fallos</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {cpsToShow.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-6 text-center text-muted-text font-mono text-[11px]">
                            Sin combinaciones con paquetes en reparto — todo cerrado ✓
                          </td>
                        </tr>
                      ) : cpsToShow.map((c) => {
                        const base = c.completado + c.enReparto + c.fallos;
                        const pct = base > 0 ? (c.completado / base) * 100 : 0;
                        const alert = c.enReparto >= 10;
                        return (
                          <tr key={`${c.driver}-${c.cp}`} className={`border-t border-hairline ${alert ? "bg-red-50 print:bg-red-100" : ""}`}>
                            <Td className="font-mono">{c.driver}</Td>
                            <Td className="font-mono">{c.cp}</Td>
                            <Td right className="tabular-nums font-semibold">{c.total}</Td>
                            <Td right className="tabular-nums">{c.completado}</Td>
                            <Td><ProgressBar pct={pct} /></Td>
                            <Td right className={`tabular-nums ${alert ? "text-red-700 font-bold" : c.enReparto > 0 ? "font-semibold" : ""}`}>{c.enReparto}</Td>
                            <Td right className={`tabular-nums ${c.fallos > 0 ? "text-danger font-semibold" : ""}`}>{c.fallos}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Incidencias */}
              {analysis.incidencias.length > 0 && (
                <section className="mb-6 print:break-before-page">
                  <h3 className="text-sm font-semibold text-ink mb-3 uppercase tracking-wide">
                    Incidencias por tipo
                  </h3>
                  <div className="rounded-lg border border-hairline bg-surface p-4 print:border-black">
                    <ul className="space-y-2">
                      {analysis.incidencias.map((i) => (
                        <li key={i.nombre} className="flex items-center gap-3 text-[12px]">
                          <span className="flex-1 min-w-0 truncate">{i.nombre}</span>
                          <IncBar count={i.count} max={analysis.incidencias[0].count} />
                          <span className="w-8 text-right font-mono tabular-nums font-semibold">{i.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
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
    ? "bg-[#F5E100] border-[#F5E100] text-ink"
    : tone === "danger"
      ? "bg-surface border-hairline text-red-700"
      : tone === "warn"
        ? "bg-[#F5E100]/40 border-[#F5E100] text-ink"
        : "bg-surface border-hairline text-ink";
  return (
    <div className={`${base} ${style}`}>
      <div className="text-[11px] font-mono uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl md:text-3xl font-semibold tabular-nums">
        {typeof value === "number" ? value.toLocaleString("es-ES") : value}
      </div>
      {sub && <div className="mt-1 text-[11px] font-mono opacity-70">{sub}</div>}
    </div>
  );
}

function Th({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <th className={`px-3 py-2 text-[10px] font-mono uppercase tracking-wide ${right ? "text-right" : "text-left"} ${className}`}>
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
