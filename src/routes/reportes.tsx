import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Upload,
  ArrowDown,
  X,
  Check,
  Loader2,
  AlertCircle,
  Database,
} from "lucide-react";
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
  head: () => ({
    meta: [
      { title: "Menssajero — Reportes" },
      {
        name: "description",
        content:
          "Sube tu ePOD y descarga cada reporte de Cainiao: DSR, CD4, CD6, OOH, ROP y PFM.",
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
      {
        id: "riesgo",
        code: "ROP",
        name: "Riesgo Operativo",
        desc: "En reparto hoy con 3+ incidencias previas.",
        freq: "DIARIO" as const,
        target: "CRÍTICO",
      },
      {
        id: "preflow",
        code: "PFM",
        name: "Pre Flow Meeting",
        desc: "PUDO por driver · Puntos y paquetes de hoy.",
        freq: "DIARIO" as const,
        target: "OPERATIVO",
      },
    ],
  },
  kpis: {
    label: "KPIs Flota",
    reportes: [
      {
        id: "dsr",
        code: "DSR",
        name: "Tasa de entrega",
        desc: "Éxito diario por driver y CP · Solo L–V.",
        freq: "SEMANAL" as const,
        target: "TGT ≥ 90%",
      },
      {
        id: "cd4",
        code: "CD4",
        name: "Alerta preventiva",
        desc: "Paquetes en riesgo antes de D+4.",
        freq: "DIARIO" as const,
        target: "PREVENTIVO",
      },
      {
        id: "cd6",
        code: "CD6",
        name: "Plazo crítico",
        desc: "Entrega antes D+6 · Target 99.5%.",
        freq: "DIARIO" as const,
        target: "TGT ≥ 99.5%",
      },
      {
        id: "ooh",
        code: "OOH",
        name: "PUDO / Out of Home",
        desc: "Uso de puntos de recogida semanal.",
        freq: "SEMANAL" as const,
        target: "TGT ≥ 95%",
      },
    ],
  },
} as const;

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function filenameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const m =
    /filename\*=UTF-8''([^;]+)/i.exec(header) ||
    /filename="?([^";]+)"?/i.exec(header);
  if (!m) return fallback;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function ReportesPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<keyof typeof TABS>("carretera");
  const [states, setStates] = useState<Record<string, ReportState>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) {
      setError("Por favor sube un archivo Excel (.xlsx)");
      return;
    }
    setError(null);
    setFile(f);
    setStates({});
  };

  const clearFile = () => {
    setFile(null);
    setStates({});
    if (inputRef.current) inputRef.current.value = "";
  };

  const { selectedHub } = useAuth();

  const descargar = async (r: Reporte) => {
    if (!file) return;
    setStates((s) => ({ ...s, [r.id]: { kind: "loading" } }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (selectedHub) {
        fd.append("hub_id", selectedHub.id);
        fd.append("hub_nombre", selectedHub.nombre);
        fd.append("hub_marca", selectedHub.marca);
        if (selectedHub.ciudad) fd.append("hub_ciudad", selectedHub.ciudad);
      }
      const res = await fetch(`${API_BASE}/reporte/${r.id}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        let msg = `Error ${res.status}`;
        try {
          const j = await res.json();
          msg = (j as { detail?: string; message?: string }).detail ||
            (j as { message?: string }).message || msg;
        } catch {
          // ignore
        }
        setStates((s) => ({ ...s, [r.id]: { kind: "error", message: msg } }));
        return;
      }
      const blob = await res.blob();
      const filename = filenameFromDisposition(
        res.headers.get("Content-Disposition"),
        `${r.code}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStates((s) => ({ ...s, [r.id]: { kind: "done" } }));
    } catch {
      setStates((s) => ({
        ...s,
        [r.id]: {
          kind: "error",
          message: "No se puede conectar con el servidor",
        },
      }));
    }
  };

  const reportes = TABS[tab].reportes;

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Reportes" />

      {/* CONTENT */}
      <div className="flex-1 flex overflow-hidden">
        {/* WORKSPACE */}
        <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-10 lg:py-14 min-w-0">
          <div className="max-w-3xl mx-auto">
            <header className="mb-12 animate-fade-up">
              <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4 flex items-center gap-2">
                <span className="size-1 bg-electric rounded-full" />
                Centro de operaciones
              </div>
              <h1 className="text-4xl lg:text-6xl font-syne font-extrabold leading-[0.95] text-ink tracking-tighter uppercase">
                Genera tus
                <br />
                <span className="font-playfair italic font-medium text-electric normal-case tracking-normal">
                  reportes Cainiao
                </span>
              </h1>
              <p className="mt-6 text-muted-text text-pretty max-w-[52ch] text-[15px] leading-relaxed">
                Sube tu ePOD del Hub <HubLabel /> una vez y descarga cada reporte por separado, listo para enviar.
              </p>

            </header>

            {/* UPLOAD */}
            <section className="mb-12 animate-fade-up" style={{ animationDelay: "60ms" }}>
              {!file ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleFile(e.dataTransfer.files?.[0]);
                  }}
                  onClick={() => inputRef.current?.click()}
                  className={`group relative border-2 border-dashed transition-colors p-10 flex flex-col items-center justify-center rounded-lg cursor-pointer ${
                    dragOver
                      ? "border-electric bg-electric/[0.04]"
                      : "border-surface-3 hover:border-electric/50 hover:bg-ink/[0.02]"
                  }`}
                >
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="sr-only"
                    onChange={(e) => handleFile(e.target.files?.[0])}
                  />
                  <div className="size-12 bg-surface-2 rounded-md flex items-center justify-center mb-4 ring-1 ring-hairline">
                    <Upload className="size-5 text-electric" strokeWidth={1.75} />
                  </div>
                  <h3 className="font-syne text-lg mb-1.5 text-ink">
                    Cargar archivo ePOD .xlsx
                  </h3>
                  <p className="text-muted-text text-xs font-mono tracking-widest uppercase">
                    Arrastra o haz click para seleccionar
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-4 p-5 bg-surface border border-hairline rounded-lg">
                  <div className="size-10 bg-electric/10 border border-electric/30 rounded flex items-center justify-center shrink-0">
                    <Check className="size-4 text-electric" strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-ink truncate">{file.name}</div>
                    <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase mt-0.5">
                      {formatSize(file.size)} · LISTO PARA PROCESAR
                    </div>
                  </div>
                  <button
                    onClick={clearFile}
                    className="size-8 rounded grid place-items-center text-muted-text hover:text-ink hover:bg-ink/5 transition-colors"
                    aria-label="Quitar archivo"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              )}

              {error && (
                <div className="mt-3 px-4 py-2.5 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs rounded-r">
                  {error}
                </div>
              )}
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
                      {active && (
                        <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-electric" />
                      )}
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
                  const disabled = !file || state.kind === "loading";
                  return (
                    <article
                      key={r.id}
                      className="group flex items-center gap-5 p-5 bg-surface hover:bg-surface-2 border border-hairline rounded-lg transition-colors"
                    >
                      <div className="font-playfair italic font-extrabold text-electric text-2xl w-14 leading-none">
                        {r.code}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                          <h3 className="font-syne font-bold text-[15px] text-ink tracking-tight">
                            {r.name}
                          </h3>
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
                          <p className="mt-1.5 text-danger text-[12px] font-mono flex items-center gap-1.5">
                            <AlertCircle className="size-3" />
                            {state.message}
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
                        {(state.kind === "idle" || state.kind === "error") && (
                          <ArrowDown className="size-3.5" />
                        )}
                        {state.kind === "done"
                          ? "Listo"
                          : state.kind === "loading"
                            ? "Generando"
                            : state.kind === "error"
                              ? "Reintentar"
                              : "Descargar"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <aside className="w-96 border-l border-hairline bg-surface p-8 hidden xl:block overflow-y-auto shrink-0">
          <div className="space-y-10">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-text mb-6">
                KPI Targets · Cainiao
              </div>
              <div className="grid grid-cols-2 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden">
                <Kpi label="DSR" value="≥ 90" suffix="%" hint="Tasa de entrega" />
                <Kpi label="CD6" value="≥ 99.5" suffix="%" hint="Plazo crítico" />
                <Kpi label="CD4" value="Alerta" hint="Preventivo" />
                <Kpi label="OOH" value="≥ 95" suffix="%" hint="Out of Home" />
              </div>
            </div>

            <div className="bg-background border border-hairline p-6 rounded-lg">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-text mb-4">
                Qué incluye cada reporte
              </div>
              <ul className="space-y-3.5 text-[13px] text-ink/80 leading-relaxed">
                <InfoLine code="ROP" text="En reparto con 3+ incidencias previas." />
                <InfoLine code="PFM" text="PUDO por driver, puntos y paquetes del día." />
                <InfoLine code="DSR" text="Tasa de éxito por driver y CP, L–V." />
                <InfoLine code="CD4" text="Paquetes en riesgo antes de D+4." />
                <InfoLine code="CD6" text="Entregados antes D+6 por CP y driver." />
                <InfoLine code="OOH" text="Uso de puntos de recogida por semana." />
              </ul>
            </div>

            <div className="bg-background border border-hairline p-6 rounded-lg">
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-text mb-4">
                Protocolo · 3 pasos
              </div>
              <ol className="space-y-4 text-[13px] text-ink/80">
                <Step n="01" title="Sube tu ePOD" sub="Archivo Excel de Cainiao." />
                <Step n="02" title="Descarga cada reporte" sub="Un botón por reporte." />
                <Step n="03" title="Envía a Cainiao" sub="Listos con el formato correcto." />
              </ol>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  suffix,
  hint,
}: {
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="bg-background p-5">
      <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-muted-text mb-3">
        {label}
      </div>
      <div className="font-mono font-medium tracking-tighter text-ink flex items-baseline gap-0.5">
        <span className="text-2xl">{value}</span>
        {suffix && <span className="text-base text-muted-text/70">{suffix}</span>}
      </div>
      {hint && (
        <div className="font-mono text-[9px] text-muted-text/70 tracking-widest uppercase mt-2">
          {hint}
        </div>
      )}
    </div>
  );
}

function InfoLine({ code, text }: { code: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="size-1.5 rounded-full bg-electric mt-2 shrink-0" />
      <span>
        <span className="font-mono text-[11px] tracking-widest text-ink mr-2">{code}</span>
        <span className="text-muted-text">{text}</span>
      </span>
    </li>
  );
}

function Step({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <li className="flex gap-4">
      <span className="font-mono text-[11px] text-electric tracking-widest pt-0.5">{n}</span>
      <span>
        <span className="block text-ink font-syne text-sm font-semibold">{title}</span>
        <span className="block text-muted-text text-xs mt-0.5">{sub}</span>
      </span>
    </li>
  );
}

function HubLabel() {
  const { selectedHub } = useAuth();
  return <span className="text-ink font-semibold">{selectedHub?.marca ?? "—"}</span>;
}
