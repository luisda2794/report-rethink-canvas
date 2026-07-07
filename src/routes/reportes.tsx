import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  ArrowDown,
  Check,
  Loader2,
  AlertCircle,
  Upload,
  FileSpreadsheet,
  X,
  Database,
} from "lucide-react";
import * as XLSX from "xlsx";
import { format, subDays } from "date-fns";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reportes")({
  component: () => (
    <RequireAuth path="/reportes">
      <ReportesPage />
    </RequireAuth>
  ),
  errorComponent: ({ error, reset }) => (
    <div className="p-8 max-w-xl mx-auto space-y-3">
      <h2 className="text-lg font-semibold">Algo falló al cargar reportes</h2>
      <pre className="text-xs bg-muted p-3 rounded overflow-auto">{String(error?.message ?? error)}</pre>
      <button onClick={reset} className="px-3 py-1.5 text-xs bg-ink text-white rounded">Reintentar</button>
    </div>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Reportes" },
      {
        name: "description",
        content:
          "Genera reportes (DSR, CD4, CD6, OOH, ROP, PFM) subiendo el archivo de Cainiao.",
      },
    ],
  }),
});

const API_BASE = "https://menssajero-api-production.up.railway.app";

type ReportState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done" }
  | { kind: "error"; message: string };

type Reporte = {
  id: string;
  code: string;
  name: string;
  desc: string;
  freq: "DIARIO" | "SEMANAL";
  target?: string;
};

const TABS = {
  carretera: {
    label: "En Carretera",
    reportes: [
      { id: "riesgo", code: "ROP", name: "Riesgo Operativo", desc: "En reparto hoy con 3+ incidencias previas.", freq: "DIARIO" as const, target: "CRÍTICO" },
      { id: "preflow", code: "PFM", name: "Pre Flow Meeting", desc: "PUDO por driver · Puntos y paquetes de hoy.", freq: "DIARIO" as const, target: "OPERATIVO" },
    ],
  },
  kpis: {
    label: "KPIs Flota",
    reportes: [
      { id: "dsr", code: "DSR", name: "Tasa de entrega", desc: "Éxito diario por driver y CP · Solo L–V.", freq: "SEMANAL" as const, target: "TGT ≥ 90%" },
      { id: "cd4", code: "CD4", name: "Alerta preventiva", desc: "Paquetes en riesgo antes de D+4.", freq: "DIARIO" as const, target: "PREVENTIVO" },
      { id: "cd6", code: "CD6", name: "Plazo crítico", desc: "Entrega antes D+6 · Target 99.5%.", freq: "DIARIO" as const, target: "TGT ≥ 99.5%" },
      { id: "ooh", code: "OOH", name: "PUDO / Out of Home", desc: "Uso de puntos de recogida semanal.", freq: "SEMANAL" as const, target: "TGT ≥ 95%" },
    ],
  },
} as const;

function filenameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const m = /filename\*=UTF-8''([^;]+)/i.exec(header) || /filename="?([^";]+)"?/i.exec(header);
  if (!m) return fallback;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

function isoToday() { return new Date().toISOString().slice(0, 10); }

function ReportesPage() {
  const { selectedHub } = useAuth();
  const [tab, setTab] = useState<keyof typeof TABS>("carretera");
  const [states, setStates] = useState<Record<string, ReportState>>({});
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(() => format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(() => format(new Date(), "yyyy-MM-dd"));

  const onPickFile = (f: File | null) => {
    setFile(f);
    setStates({});
    setGenError(null);
  };

  const generarDesdeBase = async () => {
    if (!selectedHub) return;
    setGenLoading(true);
    setGenError(null);
    try {
      const pageSize = 1000;
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("entregas")
          .select("lp_no, waybill, driver, fecha, fecha_inbound, cp, direccion, contacto, tipo, tipo_norm, estado, pop_station_id")
          .eq("hub_id", selectedHub.id)
          .gte("fecha", fromDate)
          .lte("fecha", toDate)
          .order("fecha", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = data ?? [];
        for (const r of page) {
          rows.push({
            "LP number": r.lp_no ?? "",
            "Waybill number": r.waybill ?? "",
            "Driver": r.driver ?? "",
            "Date": r.fecha ?? "",
            "Inbound Date": r.fecha_inbound ?? "",
            "CP": r.cp ?? "",
            "Address": r.direccion ?? "",
            "Contact": r.contacto ?? "",
            "Type": r.tipo_norm ?? r.tipo ?? "",
            "Status": r.estado ?? "",
            "POP Station": r.pop_station_id ?? "",
          });
        }
        if (page.length < pageSize) break;
      }
      if (rows.length === 0) {
        setGenError("No hay entregas en ese rango para este hub.");
        setGenLoading(false);
        return;
      }
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Entregas");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const filename = `entregas_${selectedHub.marca}_${fromDate}_${toDate}.xlsx`;
      const generated = new File([blob], filename, { type: blob.type });
      onPickFile(generated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al generar";
      setGenError(msg);
    } finally {
      setGenLoading(false);
    }
  };

  const descargar = async (r: Reporte) => {
    if (!file) return;
    setStates((s) => ({ ...s, [r.id]: { kind: "loading" } }));
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const res = await fetch(`${API_BASE}/reporte/${r.id}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        let msg = `Error ${res.status}`;
        try {
          const j = await res.json() as { detail?: unknown; message?: unknown };
          const d = j.detail;
          if (typeof d === "string") msg = d;
          else if (Array.isArray(d)) msg = d.map((it) => (it && typeof it === "object" && "msg" in it ? `${((it as { loc?: unknown[] }).loc ?? []).join(".")}: ${(it as { msg?: string }).msg}` : JSON.stringify(it))).join("; ");
          else if (d && typeof d === "object") msg = JSON.stringify(d);
          else if (typeof j.message === "string") msg = j.message;
        } catch { /* ignore */ }
        setStates((s) => ({ ...s, [r.id]: { kind: "error", message: msg } }));
        return;
      }
      const blob = await res.blob();
      const filename = filenameFromDisposition(res.headers.get("Content-Disposition"), `${r.code}_${isoToday()}.xlsx`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setStates((s) => ({ ...s, [r.id]: { kind: "done" } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error inesperado";
      setStates((s) => ({ ...s, [r.id]: { kind: "error", message: msg } }));
    }
  };

  const reportes = TABS[tab].reportes;

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Reportes" />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-10 lg:py-14 min-w-0">
          <div className="max-w-3xl mx-auto">
            <header className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Reportes
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Reportes del Hub <HubLabel /> generados a partir del archivo de Cainiao que subas.
              </p>
            </header>

            {/* GENERAR DESDE BASE */}
            <section className="mb-4 animate-fade-up" style={{ animationDelay: "20ms" }}>
              <div className="p-4 bg-surface border border-hairline rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <Database className="size-5 text-electric shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ink">Usar datos guardados</div>
                    <div className="text-[11px] font-mono text-muted-text">Genera el Excel desde las entregas ya cargadas en la base</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col text-[11px] font-mono text-muted-text">
                    Desde
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="mt-1 px-2 py-1.5 text-sm bg-background border border-hairline rounded text-ink"
                    />
                  </label>
                  <label className="flex flex-col text-[11px] font-mono text-muted-text">
                    Hasta
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="mt-1 px-2 py-1.5 text-sm bg-background border border-hairline rounded text-ink"
                    />
                  </label>
                  <button
                    onClick={generarDesdeBase}
                    disabled={!selectedHub || genLoading}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold font-syne tracking-tight rounded-md bg-ink text-white hover:bg-ink/90 disabled:bg-surface-2 disabled:text-muted-text disabled:cursor-not-allowed disabled:border disabled:border-hairline"
                  >
                    {genLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Database className="size-3.5" />}
                    {genLoading ? "Generando" : "Usar datos guardados"}
                  </button>
                </div>
                {genError && (
                  <p className="mt-2 text-danger text-[12px] font-mono flex items-start gap-1.5">
                    <AlertCircle className="size-3 mt-0.5 shrink-0" />
                    <span>{genError}</span>
                  </p>
                )}
              </div>
            </section>

            {/* FILE PICKER (fallback) */}
            <section className="mb-6 animate-fade-up" style={{ animationDelay: "40ms" }}>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) onPickFile(f);
                }}
                onClick={() => inputRef.current?.click()}
                className={`p-5 bg-surface border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                  dragOver ? "border-electric bg-electric/5" : "border-hairline hover:border-electric/50"
                }`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="size-6 text-electric shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink truncate">{file.name}</div>
                      <div className="text-[11px] text-muted-text font-mono">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onPickFile(null); if (inputRef.current) inputRef.current.value = ""; }}
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
                      <div className="text-sm font-semibold text-ink">O sube el archivo de Cainiao</div>
                      <div className="text-[11px] font-mono">Arrastra aquí o haz clic · .xlsx, .xls, .csv</div>
                    </div>
                  </div>
                )}
              </div>
            </section>


            {/* TABS */}
            <section className="animate-fade-up" style={{ animationDelay: "120ms" }}>
              <div className="flex items-center gap-1 border-b border-hairline mb-6">
                {(Object.keys(TABS) as Array<keyof typeof TABS>).map((key) => {
                  const active = tab === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setTab(key)}
                      className={`px-4 py-3 text-sm font-syne font-semibold tracking-tight relative transition-colors ${
                        active ? "text-ink" : "text-muted-text hover:text-ink"
                      }`}
                    >
                      {TABS[key].label}
                      {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-electric" />}
                    </button>
                  );
                })}
                <span className="ml-auto font-mono text-[10px] text-muted-text/70 tracking-widest">
                  {reportes.length} REPORTES
                </span>
              </div>

              <div className="space-y-2">
                {reportes.map((r) => {
                  const state = states[r.id] ?? { kind: "idle" as const };
                  const disabled = !selectedHub || !file || state.kind === "loading";
                  return (
                    <article
                      key={r.id}
                      className="group flex items-center gap-5 p-5 bg-surface hover:bg-surface-2 border border-hairline rounded-lg transition-colors"
                    >
                      <div className="font-semibold text-foreground text-lg tabular-nums w-14 leading-none">
                        {r.code}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                          <h3 className="font-syne font-bold text-[15px] text-ink tracking-tight">{r.name}</h3>
                          <span
                            className={`px-1.5 py-0.5 text-[9px] font-mono tracking-widest border rounded ${
                              r.freq === "DIARIO"
                                ? "bg-electric/10 text-electric border-electric/20"
                                : "bg-surface-2 text-muted-text border-hairline"
                            }`}
                          >
                            {r.freq}
                          </span>
                          {r.target && (
                            <span className="hidden md:inline font-mono text-[9px] text-muted-text/70 tracking-widest uppercase">
                              · {r.target}
                            </span>
                          )}
                        </div>
                        <p className="text-muted-text text-[13px] truncate">{r.desc}</p>
                        {state.kind === "error" && (
                          <p className="mt-1.5 text-danger text-[12px] font-mono flex items-start gap-1.5">
                            <AlertCircle className="size-3 mt-0.5 shrink-0" />
                            <span className="break-words">{state.message}</span>
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => descargar(r)}
                        disabled={disabled}
                        className={`shrink-0 inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold font-syne tracking-tight rounded-md transition-all ${
                          state.kind === "done"
                            ? "bg-success/15 text-success border border-success/30"
                            : state.kind === "loading"
                              ? "bg-surface-2 text-muted-text border border-hairline cursor-wait"
                              : state.kind === "error"
                                ? "bg-danger text-white hover:brightness-110"
                                : "bg-ink text-white hover:bg-ink/90 disabled:bg-surface-2 disabled:text-muted-text disabled:cursor-not-allowed disabled:border disabled:border-hairline"
                        }`}
                      >
                        {state.kind === "loading" && <Loader2 className="size-3.5 animate-spin" />}
                        {state.kind === "done" && <Check className="size-3.5" />}
                        {(state.kind === "idle" || state.kind === "error") && <ArrowDown className="size-3.5" />}
                        {state.kind === "done" ? "Listo" : state.kind === "loading" ? "Generando" : state.kind === "error" ? "Reintentar" : "Descargar"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function HubLabel() {
  const { selectedHub } = useAuth();
  return <span className="text-ink font-semibold">{selectedHub?.marca ?? "—"}</span>;
}
