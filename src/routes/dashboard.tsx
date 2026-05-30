import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Line,
  LineChart,
  Bar,
  BarChart,
  Pie,
  PieChart,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import { AlertTriangle, ArrowUpRight, Inbox } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth, type Hub } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/dashboard")({
  component: () => (
    <RequireAuth path="/dashboard">
      <DashboardPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Dashboard" }] }),
});

type Entrega = {
  hub_id: string;
  lp_no: string;
  driver: string | null;
  fecha: string | null;
  fecha_inbound: string | null;
  cp: string | null;
  tipo: string | null;
  estado: string;
};

type Borrador = { hub_id: string; total: number; created_at: string };
type Recla = { id: string; hub_id: string; estado: string };

type Range = { from: Date; to: Date; label: string };

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function diffDays(a: Date, b: Date) {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}
function isWeekday(d: Date) {
  const w = d.getDay();
  return w >= 1 && w <= 5;
}

function presetRange(key: string): Range {
  const now = new Date();
  if (key === "hoy") return { from: startOfDay(now), to: endOfDay(now), label: "Hoy" };
  if (key === "ayer") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { from: startOfDay(y), to: endOfDay(y), label: "Ayer" };
  }
  if (key === "semana") {
    const f = new Date(now);
    const day = (f.getDay() + 6) % 7; // Mon=0
    f.setDate(f.getDate() - day);
    return { from: startOfDay(f), to: endOfDay(now), label: "Esta semana" };
  }
  if (key === "mes") {
    const f = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: f, to: endOfDay(now), label: "Este mes" };
  }
  if (key === "trimestre") {
    const q = Math.floor(now.getMonth() / 3) * 3;
    return { from: new Date(now.getFullYear(), q, 1), to: endOfDay(now), label: "Trimestre" };
  }
  return presetRange("semana");
}

function DashboardPage() {
  const { hubs, selectedHub, role } = useAuth();
  const allowAll = role === "admin" || role === "manager";

  const [hubFilter, setHubFilter] = useState<string>(selectedHub?.id ?? "all");
  const [rangeKey, setRangeKey] = useState<string>("semana");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [range, setRange] = useState<Range>(presetRange("semana"));

  const [loading, setLoading] = useState(true);
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [prevEntregas, setPrevEntregas] = useState<Entrega[]>([]);
  const [trendEntregas, setTrendEntregas] = useState<Entrega[]>([]);
  const [borradores, setBorradores] = useState<Borrador[]>([]);
  const [openReclas, setOpenReclas] = useState<number>(0);

  useEffect(() => {
    if (selectedHub && hubFilter === "all" && !allowAll) setHubFilter(selectedHub.id);
  }, [selectedHub, hubFilter, allowAll]);

  // hub_ids in scope
  const hubIds = useMemo(() => {
    if (hubFilter === "all") return hubs.map((h) => h.id);
    return [hubFilter];
  }, [hubFilter, hubs]);

  // Fetch data when filters change
  useEffect(() => {
    if (hubIds.length === 0) return;
    let cancelled = false;
    setLoading(true);

    const span = diffDays(range.to, range.from) + 1;
    const prevFrom = new Date(range.from);
    prevFrom.setDate(prevFrom.getDate() - span);
    const prevTo = new Date(range.to);
    prevTo.setDate(prevTo.getDate() - span);

    const trendFrom = new Date(range.to);
    trendFrom.setDate(trendFrom.getDate() - 8 * 7);

    (async () => {
      const [eRes, pRes, tRes, bRes, rRes] = await Promise.all([
        supabase
          .from("entregas")
          .select("hub_id, lp_no, driver, fecha, fecha_inbound, cp, tipo, estado")
          .in("hub_id", hubIds)
          .gte("fecha", isoDate(range.from))
          .lte("fecha", isoDate(range.to))
          .limit(10000),
        supabase
          .from("entregas")
          .select("hub_id, lp_no, driver, fecha, fecha_inbound, cp, tipo, estado")
          .in("hub_id", hubIds)
          .gte("fecha", isoDate(prevFrom))
          .lte("fecha", isoDate(prevTo))
          .limit(10000),
        supabase
          .from("entregas")
          .select("hub_id, lp_no, driver, fecha, fecha_inbound, cp, tipo, estado")
          .in("hub_id", hubIds)
          .gte("fecha", isoDate(trendFrom))
          .lte("fecha", isoDate(range.to))
          .limit(20000),
        supabase
          .from("borradores")
          .select("hub_id, total, created_at")
          .in("hub_id", hubIds)
          .gte("created_at", range.from.toISOString())
          .lte("created_at", range.to.toISOString()),
        supabase
          .from("reclamaciones")
          .select("id, hub_id, estado")
          .in("hub_id", hubIds)
          .eq("estado", "abierta"),
      ]);
      if (cancelled) return;
      setEntregas((eRes.data ?? []) as Entrega[]);
      setPrevEntregas((pRes.data ?? []) as Entrega[]);
      setTrendEntregas((tRes.data ?? []) as Entrega[]);
      setBorradores(((bRes.data ?? []) as Array<{ hub_id: string; total: number | string; created_at: string }>).map((b) => ({
        hub_id: b.hub_id,
        total: Number(b.total) || 0,
        created_at: b.created_at,
      })));
      setOpenReclas((rRes.data ?? []).length);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [hubIds.join(","), range.from.getTime(), range.to.getTime()]);

  // Realtime: reclamaciones count
  useEffect(() => {
    if (hubIds.length === 0) return;
    const ch = supabase
      .channel(`dash-recla-${hubIds.join("-")}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reclamaciones" },
        async () => {
          const { data } = await supabase
            .from("reclamaciones")
            .select("id")
            .in("hub_id", hubIds)
            .eq("estado", "abierta");
          setOpenReclas((data ?? []).length);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [hubIds.join(",")]);

  // KPI calculations
  const kpis = useMemo(() => computeKpis(entregas), [entregas]);
  const prevKpis = useMemo(() => computeKpis(prevEntregas), [prevEntregas]);

  const facturado = useMemo(
    () => borradores.reduce((s, b) => s + Number(b.total || 0), 0),
    [borradores],
  );

  // DSR trend (8 weeks)
  const dsrTrend = useMemo(() => weeklyDsrSeries(trendEntregas, range.to), [trendEntregas, range.to]);
  // OOH trend (8 weeks)
  const oohTrend = useMemo(() => weeklyOohSeries(trendEntregas, range.to), [trendEntregas, range.to]);

  // Pie tipos
  const pieData = useMemo(() => {
    const counts = { TO_DOOR: 0, PUDO: 0, LOCKER: 0 };
    for (const e of entregas) {
      const t = (e.tipo || "").toUpperCase();
      if (t.includes("PUDO")) counts.PUDO++;
      else if (t.includes("LOCKER")) counts.LOCKER++;
      else counts.TO_DOOR++;
    }
    const total = counts.TO_DOOR + counts.PUDO + counts.LOCKER || 1;
    return [
      { name: "TO_DOOR", value: counts.TO_DOOR, pct: (counts.TO_DOOR / total) * 100, color: "#5b5fc7" },
      { name: "PUDO", value: counts.PUDO, pct: (counts.PUDO / total) * 100, color: "#1d7a4a" },
      { name: "LOCKER", value: counts.LOCKER, pct: (counts.LOCKER / total) * 100, color: "#a16207" },
    ];
  }, [entregas]);

  // Daily bars
  const dailyData = useMemo(() => dailySeries(entregas, range.from, range.to), [entregas, range.from, range.to]);

  // Driver ranking
  const driverRank = useMemo(() => topDrivers(entregas), [entregas]);
  // CP top
  const cpRank = useMemo(() => topCps(entregas), [entregas]);
  // Hub comparison
  const hubRank = useMemo(() => hubsComparison(entregas, hubs), [entregas, hubs]);

  const applyCustom = () => {
    if (!customFrom || !customTo) return;
    setRange({
      from: startOfDay(new Date(customFrom)),
      to: endOfDay(new Date(customTo)),
      label: `${customFrom} → ${customTo}`,
    });
    setRangeKey("custom");
  };
  const applyPreset = (k: string) => {
    setRangeKey(k);
    setRange(presetRange(k));
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Dashboard" />

      {/* FILTERS BAR */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-hairline">
        <div className="px-6 lg:px-12 py-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6 overflow-x-auto">
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-text mr-1">Hub</span>
            {allowAll && (
              <Pill active={hubFilter === "all"} onClick={() => setHubFilter("all")}>Todos</Pill>
            )}
            {hubs.map((h) => (
              <Pill key={h.id} active={hubFilter === h.id} onClick={() => setHubFilter(h.id)}>
                {h.marca}
              </Pill>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-text mr-1">Período</span>
            {[
              ["hoy", "Hoy"],
              ["ayer", "Ayer"],
              ["semana", "Esta semana"],
              ["mes", "Este mes"],
              ["trimestre", "Trimestre"],
            ].map(([k, label]) => (
              <Pill key={k} active={rangeKey === k} onClick={() => applyPreset(k)}>
                {label}
              </Pill>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="border border-hairline rounded px-2 py-1 text-xs bg-surface font-mono"
            />
            <span className="text-muted-text">—</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="border border-hairline rounded px-2 py-1 text-xs bg-surface font-mono"
            />
            <button
              onClick={applyCustom}
              disabled={!customFrom || !customTo}
              className="px-3 py-1 text-xs font-semibold tracking-tight rounded bg-ink text-white disabled:opacity-40"
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 lg:px-12 py-8 lg:py-10">
        {/* ALERT STRIP */}
        {openReclas > 0 && (
          <Link
            to="/reclamaciones"
            className="mb-6 flex items-center gap-3 px-4 py-3 rounded-md bg-danger/10 border border-danger/30 text-danger hover:bg-danger/15 transition-colors"
          >
            <span className="relative flex size-2.5">
              <span className="absolute inset-0 rounded-full bg-danger animate-ping opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-danger" />
            </span>
            <AlertTriangle className="size-4" />
            <span className="font-mono text-xs tracking-wide uppercase">
              {openReclas} {openReclas === 1 ? "reclamación abierta" : "reclamaciones abiertas"} pendientes de atención
            </span>
            <ArrowUpRight className="size-4 ml-auto" />
          </Link>
        )}

        {/* EMPTY STATE */}
        {!loading && entregas.length === 0 ? (
          <div className="border border-dashed border-hairline rounded-xl p-12 text-center bg-surface">
            <div className="size-12 mx-auto mb-4 rounded-full bg-surface-2 grid place-items-center">
              <Inbox className="size-5 text-muted-text" />
            </div>
            <h2 className="font-syne text-xl text-ink mb-2">Sin datos para el período seleccionado</h2>
            <p className="text-muted-text text-sm mb-6 max-w-md mx-auto">
              Sube un ePOD desde Facturación para empezar a ver el dashboard.
            </p>
            <Link
              to="/facturacion"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-electric text-white"
            >
              Subir ePOD <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        ) : (
          <>
            {/* KPI CARDS */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
              <KpiCard
                label="DSR"
                value={fmtPct(kpis.dsr)}
                pct={kpis.dsr}
                target={90}
                thresholds={{ good: 90, warn: 88 }}
                delta={kpis.dsr - prevKpis.dsr}
                loading={loading}
              />
              <KpiCard
                label="CD6"
                value={fmtPct(kpis.cd6)}
                pct={kpis.cd6}
                target={99.5}
                thresholds={{ good: 99.5, warn: 98 }}
                loading={loading}
              />
              <KpiCard
                label="OOH / PUDO"
                value={fmtPct(kpis.ooh)}
                pct={kpis.ooh}
                target={95}
                thresholds={{ good: 95, warn: 90 }}
                loading={loading}
              />
              <KpiCard
                label="Entregados"
                value={loading ? "…" : kpis.entregados.toLocaleString("es-ES")}
                subtitle={`de ${kpis.gestionados.toLocaleString("es-ES")} gestionados`}
                loading={loading}
              />
              <KpiCard
                label="En riesgo"
                value={loading ? "…" : String(openReclas)}
                subtitle="reclamaciones abiertas"
                valueColor={openReclas > 0 ? "text-danger" : "text-success"}
                loading={loading}
              />
              <KpiCard
                label="Facturado"
                value={loading ? "…" : `${facturado.toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`}
                subtitle="base imponible período"
                valueColor="text-electric"
                loading={loading}
              />
            </div>

            {/* CHARTS ROW 1 */}
            <div className="grid lg:grid-cols-3 gap-4 mb-4">
              <Panel className="lg:col-span-2" title="DSR semanal · 8 semanas">
                <ChartBox loading={loading}>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={dsrTrend}>
                      <CartesianGrid stroke="hsl(var(--border, 0 0% 90%))" strokeDasharray="3 3" />
                      <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                      <YAxis domain={[84, 96]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <ReferenceLine y={90} stroke="#94a3b8" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="dsr" stroke="#5b5fc7" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartBox>
              </Panel>
              <Panel title="Tipos de entrega">
                <ChartBox loading={loading}>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={80}
                        label={(d: { pct: number }) => `${d.pct.toFixed(0)}%`}
                      >
                        {pieData.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartBox>
              </Panel>
            </div>

            {/* CHARTS ROW 2 */}
            <div className="grid lg:grid-cols-3 gap-4 mb-8">
              <Panel className="lg:col-span-2" title="Entregas por día">
                <ChartBox loading={loading}>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={dailyData}>
                      <CartesianGrid stroke="hsl(var(--border, 0 0% 90%))" strokeDasharray="3 3" />
                      <XAxis dataKey="d" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="entregados" fill="#5b5fc7" />
                      <Bar dataKey="fallos" fill="#fca5a5" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartBox>
              </Panel>
              <Panel title="OOH semanal · 8 semanas">
                <ChartBox loading={loading}>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={oohTrend}>
                      <CartesianGrid stroke="hsl(var(--border, 0 0% 90%))" strokeDasharray="3 3" />
                      <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                      <YAxis domain={[88, 100]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <ReferenceLine y={95} stroke="#94a3b8" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="ooh" stroke="#1d7a4a" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartBox>
              </Panel>
            </div>

            {/* BOTTOM GRID */}
            <div className="grid lg:grid-cols-3 gap-4">
              <Panel title="Rendimiento por driver">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left">
                      <Th>Driver</Th><Th>DSR</Th><Th>Entregas</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {driverRank.length === 0 ? <EmptyRow cols={3} /> : driverRank.map((d) => (
                      <tr key={d.driver} className="border-t border-hairline">
                        <Td>{d.driver}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-surface-2 rounded overflow-hidden">
                              <div className={`h-full ${barColor(d.dsr)}`} style={{ width: `${Math.min(100, d.dsr)}%` }} />
                            </div>
                            <span className="font-mono text-[11px] w-12 text-right">{d.dsr.toFixed(1)}%</span>
                          </div>
                        </Td>
                        <Td mono>{d.entregas}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>

              <Panel title="CPs con más incidencias">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left">
                      <Th>CP</Th><Th>Volumen</Th><Th>Total</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {cpRank.length === 0 ? <EmptyRow cols={3} /> : cpRank.map((c) => (
                      <tr key={c.cp} className="border-t border-hairline">
                        <Td mono>{c.cp}</Td>
                        <Td>
                          <div className="h-1.5 bg-surface-2 rounded overflow-hidden">
                            <div className="h-full bg-danger" style={{ width: `${(c.count / cpRank[0].count) * 100}%` }} />
                          </div>
                        </Td>
                        <Td mono>{c.count}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>

              {hubFilter === "all" && (
                <Panel title="Comparativa por hub" className="hidden lg:block">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-left">
                        <Th>Hub</Th><Th>DSR</Th><Th>Entregas</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {hubRank.length === 0 ? <EmptyRow cols={3} /> : hubRank.map((h) => (
                        <tr key={h.id} className="border-t border-hairline">
                          <Td>{h.marca}</Td>
                          <Td className={dsrColor(h.dsr)}>{h.dsr.toFixed(1)}%</Td>
                          <Td mono>{h.entregas}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- helpers ----------

function computeKpis(rows: Entrega[]) {
  let entregados = 0, fallos = 0, gestionados = 0;
  let cd6Num = 0, cd6Den = 0;
  let pudo = 0, total = 0;

  for (const r of rows) {
    if (!r.fecha) continue;
    const d = new Date(r.fecha);
    gestionados++;
    const isFallo = r.estado === "fallo" || r.estado === "fallido" || r.estado === "no_entregado";
    if (isFallo) fallos++;
    else entregados++;

    // DSR only weekdays
    // counted in dsr below

    if (r.fecha_inbound) {
      cd6Den++;
      const inb = new Date(r.fecha_inbound);
      const days = diffDays(d, inb);
      if (days <= 6) cd6Num++;
    }
    total++;
    if ((r.tipo || "").toUpperCase().includes("PUDO")) pudo++;
  }

  // DSR weekday-only
  let wEntr = 0, wFall = 0;
  for (const r of rows) {
    if (!r.fecha) continue;
    const d = new Date(r.fecha);
    if (!isWeekday(d)) continue;
    const isFallo = r.estado === "fallo" || r.estado === "fallido" || r.estado === "no_entregado";
    if (isFallo) wFall++; else wEntr++;
  }
  const dsr = wEntr + wFall === 0 ? 0 : (wEntr / (wEntr + wFall)) * 100;
  const cd6 = cd6Den === 0 ? 0 : (cd6Num / cd6Den) * 100;
  const ooh = total === 0 ? 0 : (pudo / total) * 100;

  return { dsr, cd6, ooh, entregados, fallos, gestionados };
}

function weeklyDsrSeries(rows: Entrega[], to: Date) {
  const buckets: Array<{ week: string; entr: number; fall: number }> = [];
  for (let i = 7; i >= 0; i--) {
    const end = new Date(to);
    end.setDate(end.getDate() - i * 7);
    buckets.push({ week: `S${8 - i}`, entr: 0, fall: 0 });
  }
  for (const r of rows) {
    if (!r.fecha) continue;
    const d = new Date(r.fecha);
    if (!isWeekday(d)) continue;
    const days = diffDays(to, d);
    const idx = 7 - Math.floor(days / 7);
    if (idx < 0 || idx > 7) continue;
    const isFallo = r.estado === "fallo" || r.estado === "fallido";
    if (isFallo) buckets[idx].fall++;
    else buckets[idx].entr++;
  }
  return buckets.map((b) => ({
    week: b.week,
    dsr: b.entr + b.fall === 0 ? null : Number(((b.entr / (b.entr + b.fall)) * 100).toFixed(2)),
  }));
}

function weeklyOohSeries(rows: Entrega[], to: Date) {
  const buckets: Array<{ week: string; pudo: number; total: number }> = [];
  for (let i = 7; i >= 0; i--) buckets.push({ week: `S${8 - i}`, pudo: 0, total: 0 });
  for (const r of rows) {
    if (!r.fecha) continue;
    const d = new Date(r.fecha);
    const days = diffDays(to, d);
    const idx = 7 - Math.floor(days / 7);
    if (idx < 0 || idx > 7) continue;
    buckets[idx].total++;
    if ((r.tipo || "").toUpperCase().includes("PUDO")) buckets[idx].pudo++;
  }
  return buckets.map((b) => ({
    week: b.week,
    ooh: b.total === 0 ? null : Number(((b.pudo / b.total) * 100).toFixed(2)),
  }));
}

function dailySeries(rows: Entrega[], from: Date, to: Date) {
  const map = new Map<string, { entregados: number; fallos: number }>();
  const days = Math.max(1, diffDays(to, from) + 1);
  for (let i = 0; i < Math.min(days, 60); i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    map.set(isoDate(d), { entregados: 0, fallos: 0 });
  }
  for (const r of rows) {
    if (!r.fecha) continue;
    const k = r.fecha.slice(0, 10);
    if (!map.has(k)) continue;
    const o = map.get(k)!;
    const isFallo = r.estado === "fallo" || r.estado === "fallido";
    if (isFallo) o.fallos++;
    else o.entregados++;
  }
  return Array.from(map.entries()).map(([k, v]) => ({
    d: k.slice(5),
    entregados: v.entregados,
    fallos: v.fallos,
  }));
}

function topDrivers(rows: Entrega[]) {
  const map = new Map<string, { entr: number; fall: number }>();
  for (const r of rows) {
    if (!r.driver) continue;
    const o = map.get(r.driver) ?? { entr: 0, fall: 0 };
    const isFallo = r.estado === "fallo" || r.estado === "fallido";
    if (isFallo) o.fall++;
    else o.entr++;
    map.set(r.driver, o);
  }
  return Array.from(map.entries())
    .map(([driver, v]) => ({
      driver,
      entregas: v.entr + v.fall,
      dsr: v.entr + v.fall === 0 ? 0 : (v.entr / (v.entr + v.fall)) * 100,
    }))
    .sort((a, b) => b.entregas - a.entregas)
    .slice(0, 5);
}

function topCps(rows: Entrega[]) {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!r.cp) continue;
    map.set(r.cp, (map.get(r.cp) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([cp, count]) => ({ cp, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function hubsComparison(rows: Entrega[], hubs: Hub[]) {
  return hubs
    .map((h) => {
      const list = rows.filter((r) => r.hub_id === h.id);
      const k = computeKpis(list);
      return { id: h.id, marca: h.marca, dsr: k.dsr, entregas: k.entregados + k.fallos };
    })
    .filter((x) => x.entregas > 0)
    .sort((a, b) => b.entregas - a.entregas);
}

// ---------- presentational ----------

function fmtPct(v: number) {
  if (!isFinite(v) || v === 0) return "—";
  return `${v.toFixed(1)}%`;
}

function barColor(v: number) {
  if (v >= 90) return "bg-success";
  if (v >= 88) return "bg-[#a16207]";
  return "bg-danger";
}
function dsrColor(v: number) {
  if (v >= 90) return "text-success";
  if (v >= 88) return "text-[#a16207]";
  return "text-danger";
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-mono tracking-wide whitespace-nowrap transition-colors ${
        active ? "bg-ink text-white" : "bg-surface border border-hairline text-muted-text hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

function KpiCard({
  label, value, subtitle, pct, target, thresholds, delta, valueColor, loading,
}: {
  label: string;
  value: string;
  subtitle?: string;
  pct?: number;
  target?: number;
  thresholds?: { good: number; warn: number };
  delta?: number;
  valueColor?: string;
  loading?: boolean;
}) {
  const color = valueColor
    ? valueColor
    : pct != null && thresholds
      ? pct >= thresholds.good
        ? "text-success"
        : pct >= thresholds.warn
          ? "text-[#a16207]"
          : "text-danger"
      : "text-ink";
  if (loading) {
    return (
      <div className="border border-hairline rounded-lg p-5 bg-surface animate-pulse">
        <div className="h-3 bg-surface-2 rounded w-16 mb-3" />
        <div className="h-8 bg-surface-2 rounded w-24" />
      </div>
    );
  }
  return (
    <div className="border border-hairline rounded-lg p-5 bg-surface">
      <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-text mb-2">{label}</div>
      <div className={`font-syne font-extrabold text-3xl tracking-tighter ${color}`}>{value}</div>
      {pct != null && (
        <div className="mt-3 h-1.5 bg-surface-2 rounded overflow-hidden">
          <div className={`h-full ${barColor(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
      {subtitle && <div className="mt-2 text-[11px] text-muted-text">{subtitle}</div>}
      {delta != null && isFinite(delta) && delta !== 0 && (
        <div className={`mt-2 font-mono text-[10px] tracking-widest uppercase ${delta > 0 ? "text-success" : "text-danger"}`}>
          {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)} pp vs período anterior
        </div>
      )}
      {target != null && <div className="mt-1 text-[9px] font-mono text-muted-text/70 uppercase tracking-widest">Objetivo {target}%</div>}
    </div>
  );
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-hairline rounded-lg bg-surface p-5 ${className}`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-text mb-4">{title}</div>
      {children}
    </div>
  );
}

function ChartBox({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  if (loading) return <div className="h-[240px] bg-surface-2 rounded animate-pulse" />;
  return <>{children}</>;
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-2 font-mono text-[10px] tracking-widest uppercase text-muted-text font-medium">{children}</th>;
}
function Td({ children, mono, className = "" }: { children: React.ReactNode; mono?: boolean; className?: string }) {
  return <td className={`px-2 py-2 text-ink ${mono ? "font-mono text-[12px]" : ""} ${className}`}>{children}</td>;
}
function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr><td colSpan={cols} className="text-center py-6 text-muted-text text-xs">Sin datos</td></tr>
  );
}
