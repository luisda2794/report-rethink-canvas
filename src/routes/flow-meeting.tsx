import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FileSpreadsheet,
  X,
  AlertCircle,
  ChevronDown,
  Printer,
  Package,
  Database,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RequireAuth } from "@/components/RequireAuth";
import { resolveEventDate } from "@/lib/resolve-event-date";
import { getClientesLocalesConfig, isClienteLocal, isSheinClient } from "@/lib/clientes-locales-config";
import { useAuth } from "@/contexts/AuthContext";
import { useEpodDates } from "@/lib/use-epod-dates";
import {
  analyze,
  categorizar,
  dbRowsToRawRows,
  fetchDbRowsForHubDate,
  formatDate,
  fromCachedAnalysis,
  toCachedAnalysis,
  type Analysis,
  type CachedAnalysis,
  type RawRow,
} from "@/lib/flow-meeting-calc";
import { readCacheOne, writeCache } from "@/lib/hub-daily-cache";

export const Route = createFileRoute("/flow-meeting")({
  component: () => (
    <RequireAuth path="/flow-meeting">
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

// Fechas reales del evento (entrega/fallo) y mercado/vendedor (para las
// pestañas SHEIN/Clientes Locales) — opcionales: si el archivo no las trae,
// resolveEventDate() cae de vuelta en "Fecha de la tarea" y las pestañas de
// cliente simplemente no encuentran coincidencias.
const OPTIONAL_ALIASES = {
  tiempoEntrega: ["Tiempo de Entrega", "Delivery Time"],
  tiempoFracaso: ["Tiempo del Fracaso de la Entrega", "Delivery Failure Time"],
  mercado: ["Nombre del mercado", "Market Place Name"],
  vendedor: ["Nombre del vendedor", "Seller Name"],
} as const;
type OptionalField = keyof typeof OPTIONAL_ALIASES;

function resolveColumns(
  headers: string[],
):
  | { cols: Record<ColumnField, string>; optCols: Partial<Record<OptionalField, string>>; missing?: never }
  | { cols?: never; optCols?: never; missing: string[] } {
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
  if (missing.length > 0) return { missing };

  const optCols: Partial<Record<OptionalField, string>> = {};
  for (const field of Object.keys(OPTIONAL_ALIASES) as OptionalField[]) {
    const aliases = OPTIONAL_ALIASES[field];
    const found = aliases.find((a) => headers.includes(a));
    if (found) optCols[field] = found;
  }
  return { cols, optCols };
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

function pctColor(pct: number): string {
  if (pct >= 85) return "#16a34a";
  if (pct >= 70) return "#f59e0b";
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

function IncBar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex-1 h-2 rounded-full bg-neutral-200 overflow-hidden">
      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

type ClienteTab = "todos" | "shein" | "locales";

function FlowMeetingPage() {
  const { selectedHub } = useAuth();
  const [hub, setHub] = useState<HubKey | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clienteTab, setClienteTab] = useState<ClienteTab>("todos");
  const [loadedFrom, setLoadedFrom] = useState<{ label: string; via: "archivo" | "base de datos" } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- Carga desde la base (hub global + selector de día) ----
  const { data: dbDates, isLoading: dbDatesLoading } = useEpodDates(selectedHub?.id ?? null);
  const [dbDate, setDbDate] = useState<string | null>(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    setDbDate(dbDates && dbDates.length > 0 ? dbDates[0] : null);
  }, [dbDates]);

  // Cuando la carga "desde la base" pega en caché, se muestra este análisis
  // ya calculado en vez de traer filas crudas — instantáneo, pero solo sirve
  // para "Todos" (la caché guarda un único análisis agregado, no filas). Si
  // el usuario abre SHEIN/Clientes Locales sin filas crudas todavía, un
  // efecto más abajo las trae en ese momento (lazy) para poder filtrar.
  const [dbCachedAnalysis, setDbCachedAnalysis] = useState<Analysis | null>(null);

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    if (clienteTab === "todos") return rows;
    const config = getClientesLocalesConfig();
    if (clienteTab === "shein") {
      return rows.filter((r) => isSheinClient(r.mercado, r.vendedor, config));
    }
    // "locales": Cliente Local menos SHEIN
    return rows.filter((r) => isClienteLocal(r.mercado, r.vendedor, config) && !isSheinClient(r.mercado, r.vendedor, config));
  }, [rows, clienteTab]);

  const analysis = useMemo(
    () => (filteredRows ? analyze(filteredRows) : clienteTab === "todos" ? dbCachedAnalysis : null),
    [filteredRows, dbCachedAnalysis, clienteTab],
  );

  // Si el usuario abre una pestaña de cliente mientras solo tenemos el
  // análisis cacheado (sin filas crudas), traemos las filas en ese momento
  // para poder filtrar — solo pasa una vez, después rows ya queda seteado.
  useEffect(() => {
    if (clienteTab === "todos" || rows || !dbCachedAnalysis || !selectedHub || !dbDate) return;
    let cancelled = false;
    void (async () => {
      try {
        const dbRows = await fetchDbRowsForHubDate(selectedHub.id, dbDate);
        if (!cancelled) setRows(dbRowsToRawRows(dbRows));
      } catch (e) {
        console.error("[Flow Meeting] Error trayendo filas para filtrar por cliente:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [clienteTab, rows, dbCachedAnalysis, selectedHub, dbDate]);

  // Común a ambas vías (archivo o base de datos): guarda las filas parseadas
  // y el resumen en localStorage — la lógica de análisis/render no distingue
  // el origen de los datos.
  const applyParsedRows = (parsed: RawRow[], hubLabel: string, via: "archivo" | "base de datos") => {
    setRows(parsed);
    setLoadedFrom({ label: hubLabel, via });
    const a = analyze(parsed);
    if (hubLabel && a.maxDate) {
      try {
        const key = "flow_meeting_v1";
        const store = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<
          string,
          { fecha: string; total: number; pctCompletado: number; pendientes: number; updatedAt: string }
        >;
        store[hubLabel] = {
          fecha: formatDate(a.maxDate),
          total: a.totalDia,
          pctCompletado: Number(a.pctCompletado.toFixed(2)),
          pendientes: a.enReparto,
          updatedAt: new Date().toISOString(),
        };
        localStorage.setItem(key, JSON.stringify(store));
      } catch { /* ignore */ }
    }
  };

  const handleLoadFromDb = async () => {
    if (!selectedHub || !dbDate) return;
    setDbLoading(true);
    setDbError(null);
    setFile(null);
    setRows(null);
    setDbCachedAnalysis(null);
    try {
      const hubLabel = `${selectedHub.marca} · ${selectedHub.nombre}`;

      // Lectura con fallback: si ya está cacheado para este día, instantáneo
      // (sin traer filas crudas). Si no (o si la lectura a la caché falla —
      // readCacheOne ya se traga esos errores y devuelve null), se calcula
      // en vivo como siempre y de paso se deja la caché tibia.
      const cached = await readCacheOne<CachedAnalysis>(selectedHub.id, "flow_meeting", dbDate);
      if (cached) {
        setDbCachedAnalysis(fromCachedAnalysis(cached, dbDate));
        setLoadedFrom({ label: hubLabel, via: "base de datos" });
        setClienteTab("todos");
        return;
      }

      const dbRows = await fetchDbRowsForHubDate(selectedHub.id, dbDate);
      if (dbRows.length === 0) throw new Error("No hay filas para ese hub y fecha en la base de datos.");
      const parsed = dbRowsToRawRows(dbRows);
      applyParsedRows(parsed, hubLabel, "base de datos");
      const a = analyze(parsed);
      void writeCache(selectedHub.id, "flow_meeting", dbDate, toCachedAnalysis(a)).catch((e) =>
        console.error("[Flow Meeting] Error escribiendo caché:", e),
      );
    } catch (e) {
      console.error("[Flow Meeting] Error cargando desde la base:", e);
      setDbError(e instanceof Error ? e.message : "Error cargando desde la base de datos.");
    } finally {
      setDbLoading(false);
    }
  };

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
        const estado = String(r[cols.estado] ?? "").trim();
        const fecha = resolveEventDate({
          estado,
          fechaTarea: parseFecha(r[cols.fecha]),
          tiempoEntrega: optCols.tiempoEntrega ? parseFecha(r[optCols.tiempoEntrega]) : null,
          tiempoFracaso: optCols.tiempoFracaso ? parseFecha(r[optCols.tiempoFracaso]) : null,
        });
        return {
          waybill: String(r[cols.waybill] ?? "").trim(),
          fecha,
          estado,
          categoria: categorizar(estado),
          incidencia: String(r[cols.incidencia] ?? "").trim(),
          cp: String(r[cols.cp] ?? "").trim(),
          driver: String(r[cols.driver] ?? "").trim(),
          tipoEntrega: String(r[cols.tipoEntrega] ?? "").trim(),
          mercado: optCols.mercado ? String(r[optCols.mercado] ?? "").trim() : "",
          vendedor: optCols.vendedor ? String(r[optCols.vendedor] ?? "").trim() : "",
          rowIndex: i,
        };
      });
      applyParsedRows(parsed, hub, "archivo");
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
    <div className="flex flex-col gap-6 print:bg-white">
      <div className="print:px-6 print:py-4">
        <header className="mb-6 print:mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight print:text-xl">
              Flow Meeting
            </h1>
            <p className="mt-1 text-sm text-muted-foreground print:text-xs">
              Dashboard de la reunión de flujo — foto del día operativo.
              {analysis && loadedFrom && (
                <>
                  {" "}Hub <strong>{loadedFrom.label}</strong> · Fecha <strong>{formatDate(analysis.maxDate)}</strong>
                  {" "}({loadedFrom.via})
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

          {/* Cargar desde la base de datos (hidden in print) */}
          <div className="print:hidden">
            <section className="mb-6 p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Database className="size-4 text-electric" />
                <h3 className="text-sm font-semibold text-foreground">Cargar desde la base de datos</h3>
              </div>
              {!selectedHub ? (
                <p className="text-[12px] text-muted-foreground">
                  Selecciona un hub en la barra superior para cargar el día más reciente con datos.
                </p>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="text-[11px] uppercase text-muted-foreground tracking-wide">Hub</label>
                    <div className="mt-1 text-sm font-medium text-foreground">
                      {selectedHub.marca} · {selectedHub.nombre}
                    </div>
                  </div>
                  <div className="min-w-[180px]">
                    <label className="text-[11px] uppercase text-muted-foreground tracking-wide">Día</label>
                    <Select
                      value={dbDate ?? undefined}
                      onValueChange={setDbDate}
                      disabled={dbDatesLoading || !dbDates || dbDates.length === 0}
                    >
                      <SelectTrigger className="mt-1 w-full">
                        <SelectValue placeholder={dbDatesLoading ? "Cargando…" : "Sin ePOD para este hub"} />
                      </SelectTrigger>
                      <SelectContent>
                        {(dbDates ?? []).map((d) => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={() => void handleLoadFromDb()} disabled={!dbDate || dbLoading} size="sm" className="gap-2">
                    {dbLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Database className="size-3.5" />}
                    {dbLoading ? "Cargando…" : "Cargar desde la base"}
                  </Button>
                </div>
              )}
              {dbError && (
                <p className="mt-2 text-destructive text-[12px] flex items-start gap-1.5">
                  <AlertCircle className="size-3 mt-0.5 shrink-0" />
                  <span>{dbError}</span>
                </p>
              )}
            </section>
          </div>

          {/* Hub selector + Dropzone: análisis ad-hoc subiendo un Excel puntual (hidden in print) */}
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

          {(rows || dbCachedAnalysis) && (
            <Tabs value={clienteTab} onValueChange={(v) => setClienteTab(v as ClienteTab)} className="print:hidden mb-6">
              <TabsList>
                <TabsTrigger value="todos">Todos</TabsTrigger>
                <TabsTrigger value="shein">SHEIN</TabsTrigger>
                <TabsTrigger value="locales">Clientes Locales</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

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
                <section className="mb-6 p-4 rounded-lg border bg-card print:border-black">
                  <div className="flex items-center gap-2 mb-3">
                    <Package className="size-4 text-electric" />
                    <h3 className="text-sm font-semibold text-foreground">PUDOs del día</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                    <div>
                      <div className="text-[11px] uppercase text-muted-foreground">Total PUDO</div>
                      <div className="text-2xl font-semibold tabular-nums">{analysis.pudoTotal}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase text-muted-foreground">Entregados</div>
                      <div className="text-2xl font-semibold tabular-nums">{analysis.pudoEntregados}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase text-muted-foreground mb-1">% Entrega PUDO</div>
                      <ProgressBar
                        pct={analysis.pudoTotal > 0 ? (analysis.pudoEntregados / analysis.pudoTotal) * 100 : 0}
                      />
                    </div>
                  </div>
                  {analysis.pudoPendientes > 0 && (
                    <div className="mt-3 p-2.5 rounded-md bg-warn/15 text-foreground text-[13px] font-semibold border border-warn/40">
                      ⚠ {analysis.pudoPendientes} PUDO{analysis.pudoPendientes === 1 ? "" : "s"} pendiente{analysis.pudoPendientes === 1 ? "" : "s"} por entregar
                    </div>
                  )}
                </section>
              )}

              {/* Drivers */}
              <section className="mb-6 print:break-before-page">
                <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">
                  Resumen por Driver
                </h3>
                <div className="overflow-x-auto rounded-lg border bg-card print:border-black">
                  <table className="w-full text-[12px]">
                    <thead className="bg-muted text-foreground">
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
                          <tr key={d.driver} className="border-t border-border">
                            <Td>{d.driver}</Td>
                            <Td right className="tabular-nums font-semibold">{d.total}</Td>
                            <Td right className="tabular-nums">{d.entregado}</Td>
                            <Td right className="tabular-nums">{d.devolucion}</Td>
                            <Td><ProgressBar pct={pct} /></Td>
                            <Td right className="tabular-nums">{d.enReparto}</Td>
                            <Td right className={`tabular-nums ${d.fallos > 0 ? "text-destructive font-semibold" : ""}`}>{d.fallos}</Td>
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
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                    {showFullCp ? "Detalle por CP" : "Puntos Críticos por CP"}
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    {analysis.cpsCount} CPs · {showFullCp ? "vista completa" : `mostrando ${cpsToShow.length} combinaciones con paquetes en reparto`}
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border bg-card print:border-black">
                  <table className="w-full text-[12px]">
                    <thead className="bg-muted text-foreground">
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
                          <td colSpan={7} className="p-6 text-center text-muted-foreground text-[11px]">
                            Sin combinaciones con paquetes en reparto — todo cerrado ✓
                          </td>
                        </tr>
                      ) : cpsToShow.map((c) => {
                        const base = c.completado + c.enReparto + c.fallos;
                        const pct = base > 0 ? (c.completado / base) * 100 : 0;
                        const alert = c.enReparto >= 10;
                        return (
                          <tr key={`${c.driver}-${c.cp}`} className={`border-t border-border ${alert ? "bg-destructive/10 print:bg-destructive/10" : ""}`}>
                            <Td>{c.driver}</Td>
                            <Td>{c.cp}</Td>
                            <Td right className="tabular-nums font-semibold">{c.total}</Td>
                            <Td right className="tabular-nums">{c.completado}</Td>
                            <Td><ProgressBar pct={pct} /></Td>
                            <Td right className={`tabular-nums ${alert ? "text-destructive font-bold" : c.enReparto > 0 ? "font-semibold" : ""}`}>{c.enReparto}</Td>
                            <Td right className={`tabular-nums ${c.fallos > 0 ? "text-destructive font-semibold" : ""}`}>{c.fallos}</Td>
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
                  <h3 className="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">
                    Incidencias por tipo
                  </h3>
                  <div className="rounded-lg border bg-card p-4 print:border-black">
                    <ul className="space-y-2">
                      {analysis.incidencias.map((i) => (
                        <li key={i.nombre} className="flex items-center gap-3 text-[12px]">
                          <span className="flex-1 min-w-0 truncate">{i.nombre}</span>
                          <IncBar count={i.count} max={analysis.incidencias[0].count} />
                          <span className="w-8 text-right tabular-nums font-semibold">{i.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}
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
        : "bg-card border text-foreground";
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
