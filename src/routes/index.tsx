import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  Package,
  BarChart3,
  FileText,
  Truck,
  AlertTriangle,
  Settings,
  Upload,
  ArrowDown,
  X,
  Check,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: ReportesPage,
  head: () => ({
    meta: [
      { title: "Menssajero — Reportes" },
      {
        name: "description",
        content:
          "Centro de operaciones Menssajero. Sube tu ePOD y descarga reportes DSR, CD4, CD6, OOH/PUDO y Riesgo Operativo.",
      },
    ],
  }),
});

type ReportState = "idle" | "loading" | "done" | "error";

type Reporte = {
  id: string;
  code: string;
  name: string;
  desc: string;
  freq: "DIARIO" | "SEMANAL";
  accent?: boolean;
  target?: string;
};

const REPORTES: Reporte[] = [
  {
    id: "dsr",
    code: "DSR",
    name: "Tasa de entrega",
    desc: "Éxito diario por driver y CP. Solo L–V.",
    freq: "SEMANAL",
    accent: true,
    target: "TGT ≥ 90%",
  },
  {
    id: "cd4",
    code: "CD4",
    name: "Alerta preventiva",
    desc: "Paquetes en riesgo antes de D+4.",
    freq: "DIARIO",
    target: "PREVENTIVO",
  },
  {
    id: "cd6",
    code: "CD6",
    name: "Plazo crítico",
    desc: "Entrega antes D+6 por CP y repartidor.",
    freq: "DIARIO",
    target: "TGT ≥ 99.5%",
  },
  {
    id: "ooh",
    code: "OOH",
    name: "PUDO / Out of Home",
    desc: "Uso de puntos de recogida semanal.",
    freq: "SEMANAL",
    target: "TGT ≥ 95%",
  },
  {
    id: "riesgo",
    code: "ROP",
    name: "Riesgo operativo",
    desc: "En reparto hoy con 3+ incidencias previas.",
    freq: "DIARIO",
    target: "CRÍTICO",
  },
];

const NAV = [
  { icon: Package, label: "ePOD" },
  { icon: BarChart3, label: "Reportes", active: true },
  { icon: FileText, label: "Borradores" },
  { icon: Truck, label: "Repartidores" },
  { icon: AlertTriangle, label: "Reclamaciones" },
];

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function ReportesPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const descargar = async (id: string) => {
    if (!file) return;
    setStates((s) => ({ ...s, [id]: "loading" }));
    // Demo timeout — sustituir por llamada real al backend
    await new Promise((r) => setTimeout(r, 1100));
    setStates((s) => ({ ...s, [id]: "done" }));
  };

  return (
    <div className="min-h-screen bg-ink text-foreground font-syne flex">
      {/* SIDEBAR */}
      <aside className="w-20 lg:w-60 border-r border-hairline flex flex-col shrink-0 sticky top-0 h-screen">
        <div className="p-5">
          <div className="size-10 bg-electric flex items-center justify-center rounded-sm">
            <span className="font-playfair italic font-extrabold text-ink text-2xl leading-none">
              M
            </span>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1 mt-4">
          {NAV.map(({ icon: Icon, label, active }) => (
            <a
              key={label}
              href="#"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors group ${
                active
                  ? "bg-white/5 text-electric"
                  : "text-muted-text hover:text-white hover:bg-white/[0.03]"
              }`}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.75} />
              <span className="hidden lg:block text-sm font-medium tracking-tight">
                {label}
              </span>
              {active && (
                <span className="hidden lg:block ml-auto size-1.5 rounded-full bg-electric animate-pulse" />
              )}
            </a>
          ))}
        </nav>

        <div className="p-3 border-t border-hairline">
          <a
            href="#"
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-muted-text hover:text-white hover:bg-white/[0.03] transition-colors"
          >
            <Settings className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="hidden lg:block text-sm font-medium">Ajustes</span>
          </a>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* TOPBAR */}
        <header className="h-16 border-b border-hairline flex items-center justify-between px-6 lg:px-10 shrink-0 sticky top-0 bg-ink/80 backdrop-blur-md z-40">
          <div className="flex items-center gap-4">
            <span className="font-playfair italic font-extrabold tracking-tight text-xl">
              Men<span className="text-electric">s</span>sajero
            </span>
            <span className="text-zinc-700">/</span>
            <span className="text-muted-text font-mono text-[11px] tracking-widest uppercase">
              Reportes
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-[10px] text-muted-text tracking-widest hidden sm:block">
              USER_ID · ZR_09
            </span>
            <div className="size-8 bg-electric rounded-full flex items-center justify-center text-[11px] font-bold text-ink font-syne">
              ZR
            </div>
          </div>
        </header>

        {/* CONTENT */}
        <div className="flex-1 flex overflow-hidden">
          {/* WORKSPACE */}
          <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-10 lg:py-14">
            <div className="max-w-4xl mx-auto">
              {/* HERO */}
              <header className="mb-14 animate-fade-up">
                <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4 flex items-center gap-2">
                  <span className="size-1 bg-electric rounded-full" />
                  Centro de operaciones · LOG_ACTIVE
                </div>
                <h1 className="text-5xl lg:text-7xl font-syne font-extrabold leading-[0.9] text-white tracking-tighter uppercase text-balance">
                  Inteligencia
                  <br />
                  <span className="font-playfair italic font-medium text-electric normal-case tracking-normal">
                    de operaciones
                  </span>
                </h1>
                <p className="mt-7 text-muted-text text-pretty max-w-[52ch] text-[15px] leading-relaxed">
                  Sube tu ePOD del Hub Zerol y descarga cada reporte de
                  Cainiao por separado. DSR, CD4, CD6, OOH y Riesgo Operativo —
                  cada uno en su propio Excel, listo para enviar.
                </p>
              </header>

              {/* UPLOAD */}
              <section className="mb-16 animate-fade-up" style={{ animationDelay: "60ms" }}>
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
                    className={`group relative border-2 border-dashed transition-colors p-12 flex flex-col items-center justify-center rounded-lg cursor-pointer ${
                      dragOver
                        ? "border-electric bg-electric/[0.04]"
                        : "border-surface-3 hover:border-electric/50 hover:bg-white/[0.02]"
                    }`}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="sr-only"
                      onChange={(e) => handleFile(e.target.files?.[0])}
                    />
                    <div className="size-12 bg-surface rounded flex items-center justify-center mb-4 ring-1 ring-hairline">
                      <Upload className="size-5 text-electric" strokeWidth={1.75} />
                    </div>
                    <h3 className="font-syne text-lg mb-1.5 text-white">
                      Cargar archivo .xlsx
                    </h3>
                    <p className="text-muted-text text-xs font-mono tracking-widest uppercase">
                      Arrastra o haz click para seleccionar
                    </p>
                    <div className="absolute bottom-3 right-3">
                      <span className="px-2 py-1 bg-surface text-[9px] font-mono tracking-widest text-muted-text border border-hairline uppercase">
                        IDLE_STATE
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4 p-5 bg-surface border border-hairline rounded-lg">
                    <div className="size-10 bg-electric/10 border border-electric/30 rounded flex items-center justify-center shrink-0">
                      <Check className="size-4 text-electric" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm text-white truncate">
                        {file.name}
                      </div>
                      <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase mt-0.5">
                        {formatSize(file.size)} · LISTO PARA PROCESAR
                      </div>
                    </div>
                    <span className="hidden sm:block px-2 py-1 bg-electric/10 text-electric text-[10px] font-mono border border-electric/20 uppercase tracking-widest">
                      ACTIVO
                    </span>
                    <button
                      onClick={clearFile}
                      className="size-8 rounded grid place-items-center text-muted-text hover:text-white hover:bg-white/5 transition-colors"
                      aria-label="Quitar archivo"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )}

                {error && (
                  <div className="mt-3 px-4 py-2.5 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs">
                    {error}
                  </div>
                )}
              </section>

              {/* REPORTS LIST */}
              <section className="animate-fade-up" style={{ animationDelay: "120ms" }}>
                <div className="flex items-center justify-between border-b border-hairline pb-3 mb-6">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-text">
                    Catálogo de reportes
                  </h2>
                  <span className="font-mono text-[10px] text-zinc-600 tracking-widest">
                    {REPORTES.length} DISPONIBLES
                  </span>
                </div>

                <div className="space-y-2">
                  {REPORTES.map((r) => {
                    const state = states[r.id] ?? "idle";
                    const disabled = !file || state === "loading";
                    return (
                      <article
                        key={r.id}
                        className="group flex items-center gap-5 p-5 bg-surface/50 hover:bg-surface border border-hairline transition-colors"
                      >
                        <div className="font-playfair italic font-extrabold text-electric text-2xl w-14 leading-none">
                          {r.code}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2.5 mb-1">
                            <h3 className="font-syne font-bold text-[15px] text-white tracking-tight">
                              {r.name}
                            </h3>
                            <span
                              className={`px-1.5 py-0.5 text-[9px] font-mono tracking-widest border ${
                                r.freq === "DIARIO"
                                  ? "bg-electric/10 text-electric border-electric/20"
                                  : "bg-surface-2 text-muted-text border-hairline"
                              }`}
                            >
                              {r.freq}
                            </span>
                            {r.target && (
                              <span className="hidden md:inline font-mono text-[9px] text-zinc-600 tracking-widest uppercase">
                                · {r.target}
                              </span>
                            )}
                          </div>
                          <p className="text-muted-text text-[13px] truncate">
                            {r.desc}
                          </p>
                        </div>
                        <button
                          onClick={() => descargar(r.id)}
                          disabled={disabled}
                          className={`shrink-0 inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold font-syne tracking-tight transition-all ${
                            state === "done"
                              ? "bg-success/15 text-success border border-success/30"
                              : state === "loading"
                                ? "bg-white/5 text-muted-text border border-hairline cursor-wait"
                                : r.accent && file
                                  ? "bg-electric text-ink hover:brightness-110"
                                  : "bg-white text-ink hover:bg-white/90 disabled:bg-surface-2 disabled:text-zinc-600 disabled:cursor-not-allowed disabled:border disabled:border-hairline"
                          }`}
                        >
                          {state === "loading" && (
                            <Loader2 className="size-3.5 animate-spin" />
                          )}
                          {state === "done" && <Check className="size-3.5" />}
                          {state === "idle" && <ArrowDown className="size-3.5" />}
                          {state === "done"
                            ? "Listo"
                            : state === "loading"
                              ? "Generando"
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
          <aside className="w-96 border-l border-hairline bg-ink p-8 hidden xl:block overflow-y-auto shrink-0">
            <div className="space-y-10">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-text mb-6">
                  KPIs · semana actual
                </div>
                <div className="grid grid-cols-2 gap-px bg-hairline border border-hairline">
                  <Kpi label="DSR" value="90" suffix="%" tone="success" hint="TGT ≥ 90%" />
                  <Kpi label="CD6" value="99.5" suffix="%" tone="success" hint="TGT ≥ 99.5%" />
                  <Kpi label="CD4" value="Alerta" tone="warn" hint="Preventivo" />
                  <Kpi label="OOH" value="95" suffix="%" tone="success" hint="TGT ≥ 95%" />
                </div>
              </div>

              <div className="bg-surface border border-hairline p-6">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-text mb-4">
                  Qué incluye cada reporte
                </div>
                <ul className="space-y-3.5 text-[13px] text-zinc-300 leading-relaxed">
                  <InfoLine code="DSR" text="Tasa de éxito por driver y CP. Solo L–V." dot="success" />
                  <InfoLine code="CD4" text="Paquetes en riesgo antes de D+4." dot="warn" />
                  <InfoLine code="CD6" text="Entregados antes D+6 por CP y repartidor." dot="electric" />
                  <InfoLine code="OOH" text="Uso de puntos de recogida por semana." dot="success" />
                </ul>
              </div>

              <div className="bg-surface border border-hairline p-6">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-text mb-4">
                  Protocolo · 3 pasos
                </div>
                <ol className="space-y-4 text-[13px] text-zinc-300">
                  <Step n="01" title="Sube tu ePOD" sub="Archivo Excel de Cainiao." />
                  <Step n="02" title="Descarga cada reporte" sub="Un botón por reporte." />
                  <Step n="03" title="Envía a Cainiao" sub="Listos con el formato correcto." />
                </ol>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Kpi({
  label,
  value,
  suffix,
  tone,
  hint,
}: {
  label: string;
  value: string;
  suffix?: string;
  tone: "success" | "warn" | "danger";
  hint?: string;
}) {
  const toneColor =
    tone === "success" ? "text-success" : tone === "warn" ? "text-warn" : "text-danger";
  return (
    <div className="bg-ink p-5">
      <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-muted-text mb-3">
        {label}
      </div>
      <div className={`font-mono font-medium tracking-tighter ${toneColor} flex items-baseline gap-0.5`}>
        <span className="text-3xl">{value}</span>
        {suffix && <span className="text-base text-zinc-600">{suffix}</span>}
      </div>
      {hint && (
        <div className="font-mono text-[9px] text-zinc-600 tracking-widest uppercase mt-2">
          {hint}
        </div>
      )}
    </div>
  );
}

function InfoLine({
  code,
  text,
  dot,
}: {
  code: string;
  text: string;
  dot: "success" | "warn" | "electric";
}) {
  const c =
    dot === "success" ? "bg-success" : dot === "warn" ? "bg-warn" : "bg-electric";
  return (
    <li className="flex gap-3">
      <span className={`size-1.5 rounded-full ${c} mt-2 shrink-0`} />
      <span>
        <span className="font-mono text-[11px] tracking-widest text-white mr-2">
          {code}
        </span>
        <span className="text-muted-text">{text}</span>
      </span>
    </li>
  );
}

function Step({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <li className="flex gap-4">
      <span className="font-mono text-[11px] text-electric tracking-widest pt-0.5">
        {n}
      </span>
      <span>
        <span className="block text-white font-syne text-sm font-semibold">
          {title}
        </span>
        <span className="block text-muted-text text-xs mt-0.5">{sub}</span>
      </span>
    </li>
  );
}
