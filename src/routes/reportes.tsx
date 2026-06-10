import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  Check,
  Loader2,
  AlertCircle,
  Database,
  Calendar as CalendarIcon,
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
          "Genera reportes (DSR, CD4, CD6, OOH, ROP, PFM) a partir de los datos guardados en la nube.",
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

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function isoToday() { return iso(new Date()); }
function isoDaysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
function startOfWeek() {
  const d = new Date();
  const day = d.getDay(); // 0 sun .. 6 sat
  const diff = (day === 0 ? -6 : 1 - day); // monday
  d.setDate(d.getDate() + diff);
  return iso(d);
}
function startOfMonth() { const d = new Date(); d.setDate(1); return iso(d); }
function lastMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: iso(first), to: iso(last) };
}

function fmtES(d: string) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

type Preset = "semana" | "mes" | "ultimo_mes" | "custom";

function ReportesPage() {
  const { selectedHub } = useAuth();
  const [tab, setTab] = useState<keyof typeof TABS>("carretera");
  const [states, setStates] = useState<Record<string, ReportState>>({});

  const [preset, setPreset] = useState<Preset>("semana");
  const [fromDate, setFromDate] = useState<string>(startOfWeek());
  const [toDate, setToDate] = useState<string>(isoToday());

  const [stats, setStats] = useState<{ count: number; min: string | null; max: string | null } | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Load availability stats for this hub
  useEffect(() => {
    if (!selectedHub) { setStats({ count: 0, min: null, max: null }); setStatsLoading(false); return; }
    let cancelled = false;
    setStatsLoading(true);
    void (async () => {
      const [{ count }, { data: minRow }, { data: maxRow }] = await Promise.all([
        supabase.from("entregas").select("id", { count: "exact", head: true }).eq("hub_id", selectedHub.id),
        supabase.from("entregas").select("fecha").eq("hub_id", selectedHub.id).not("fecha", "is", null).order("fecha", { ascending: true }).limit(1).maybeSingle(),
        supabase.from("entregas").select("fecha").eq("hub_id", selectedHub.id).not("fecha", "is", null).order("fecha", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (cancelled) return;
      setStats({ count: count ?? 0, min: (minRow?.fecha as string | null) ?? null, max: (maxRow?.fecha as string | null) ?? null });
      setStatsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedHub?.id]);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    setStates({});
    if (p === "semana") { setFromDate(startOfWeek()); setToDate(isoToday()); }
    else if (p === "mes") { setFromDate(startOfMonth()); setToDate(isoToday()); }
    else if (p === "ultimo_mes") { const r = lastMonthRange(); setFromDate(r.from); setToDate(r.to); }
  };

  const fetchEntregas = async () => {
    if (!selectedHub) return [];
    const all: Record<string, unknown>[] = [];
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error: qErr } = await supabase
        .from("entregas")
        .select("lp_no, waybill, driver, fecha, fecha_inbound, cp, tipo, tipo_norm, estado, es_aa, direccion, contacto, pop_station_id")
        .eq("hub_id", selectedHub.id)
        .gte("fecha", fromDate)
        .lte("fecha", toDate)
        .range(from, from + pageSize - 1);
      if (qErr) throw qErr;
      const rows = (data ?? []) as Record<string, unknown>[];
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return all;
  };

  const descargar = async (r: Reporte) => {
    if (!selectedHub) return;
    setStates((s) => ({ ...s, [r.id]: { kind: "loading" } }));
    try {
      const entregas = await fetchEntregas();
      if (entregas.length === 0) {
        setStates((s) => ({ ...s, [r.id]: { kind: "error", message: "Sin datos en el período seleccionado" } }));
        return;
      }
      const res = await fetch(`${API_BASE}/reporte/${r.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hub: selectedHub.nombre,
          hub_id: selectedHub.id,
          hub_marca: selectedHub.marca,
          hub_ciudad: selectedHub.ciudad ?? null,
          fecha_desde: fromDate,
          fecha_hasta: toDate,
          entregas,
        }),
      });
      if (!res.ok) {
        let msg = `Error ${res.status}`;
        try { const j = await res.json(); msg = (j as { detail?: string; message?: string }).detail || (j as { message?: string }).message || msg; } catch { /* ignore */ }
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
    } catch {
      setStates((s) => ({ ...s, [r.id]: { kind: "error", message: "No se puede conectar con el servidor" } }));
    }
  };

  const reportes = TABS[tab].reportes;
  const hasData = (stats?.count ?? 0) > 0;

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
                Reportes del Hub <HubLabel /> generados a partir de los datos cargados en{" "}
                <Link to="/epod" className="underline underline-offset-2">/epod</Link>.
              </p>
            </header>

            {/* DATE RANGE */}
            <section className="mb-6 animate-fade-up" style={{ animationDelay: "40ms" }}>
              <div className="p-4 bg-surface border border-hairline rounded-lg space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10px] tracking-widest uppercase text-muted-text inline-flex items-center gap-1.5">
                    <CalendarIcon className="size-3.5 text-electric" />
                    Período
                  </span>
                  {([
                    ["semana", "Esta semana"],
                    ["mes", "Este mes"],
                    ["ultimo_mes", "Último mes"],
                    ["custom", "Personalizado"],
                  ] as Array<[Preset, string]>).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => applyPreset(k)}
                      className={`px-3 py-1 rounded-full font-mono text-[10px] tracking-widest uppercase border transition-colors ${
                        preset === k
                          ? "bg-ink text-white border-ink"
                          : "bg-background text-muted-text border-hairline hover:border-electric hover:text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => { setFromDate(e.target.value); setPreset("custom"); setStates({}); }}
                    className="border border-hairline rounded px-2 py-1 text-xs bg-background font-mono"
                  />
                  <span className="text-muted-text">—</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => { setToDate(e.target.value); setPreset("custom"); setStates({}); }}
                    className="border border-hairline rounded px-2 py-1 text-xs bg-background font-mono"
                  />
                </div>
              </div>

              {/* STATUS INDICATOR */}
              <div className="mt-3">
                {statsLoading ? (
                  <div className="px-4 py-2.5 border-l-2 border-hairline bg-surface text-muted-text font-mono text-xs rounded-r inline-flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" /> Comprobando datos disponibles…
                  </div>
                ) : hasData ? (
                  <div className="px-4 py-2.5 border-l-2 border-emerald-500 bg-emerald-500/10 text-emerald-700 font-mono text-xs rounded-r inline-flex items-center gap-2">
                    <span className="size-2 rounded-full bg-emerald-500" />
                    <span>
                      Datos disponibles: <span className="font-bold">{stats!.count.toLocaleString("es-ES")}</span> paquetes
                      {stats!.min && stats!.max && (
                        <> del <span className="font-bold">{fmtES(stats!.min)}</span> al <span className="font-bold">{fmtES(stats!.max)}</span></>
                      )}
                    </span>
                  </div>
                ) : (
                  <div className="px-4 py-2.5 border-l-2 border-amber-500 bg-amber-500/10 text-amber-700 font-mono text-xs rounded-r inline-flex items-center gap-2">
                    <span className="size-2 rounded-full bg-amber-500" />
                    <span>
                      Sin datos · <Link to="/epod" className="underline hover:text-amber-900">Sube un ePOD primero</Link>
                    </span>
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
                  const disabled = !selectedHub || !hasData || state.kind === "loading";
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
