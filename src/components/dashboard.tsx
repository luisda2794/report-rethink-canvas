import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CalendarIcon } from "lucide-react";
import { format, subDays, differenceInCalendarDays, addDays, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

function toISO(d: Date) {
  return format(d, "yyyy-MM-dd");
}

type DayAgg = { fecha: string; total: number; entregados: number; incidencias: number; en_reparto: number };
type TipoAgg = { tipo: string; n: number };
type DashStats = {
  total: number;
  aa: number;
  en_reparto_hoy: number;
  by_day: DayAgg[];
  by_tipo: TipoAgg[];
};

function useDashStats(hubIds: string[], fromISO: string, toISO: string) {
  return useQuery({
    queryKey: ["dash-stats", hubIds.slice().sort().join(","), fromISO, toISO],
    enabled: hubIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<DashStats> => {
      const { data, error } = await supabase.rpc("dashboard_stats", {
        _hub_ids: hubIds,
        _from: fromISO,
        _to: toISO,
      });
      if (error) throw error;
      const d = (data ?? {}) as Partial<DashStats>;
      return {
        total: d.total ?? 0,
        aa: d.aa ?? 0,
        en_reparto_hoy: d.en_reparto_hoy ?? 0,
        by_day: d.by_day ?? [],
        by_tipo: d.by_tipo ?? [],
      };
    },
  });
}

/* ---------------- KPIs ---------------- */

function Stats({
  current,
  previous,
  days,
}: {
  current: DashStats;
  previous: DashStats;
  days: number;
}) {
  const total = current.total;
  const totalPrev = previous.total;
  const deltaEntregas =
    totalPrev > 0 ? ((total - totalPrev) / totalPrev) * 100 : 0;

  const aa = current.aa;
  const aaPct = total ? (aa / total) * 100 : 0;

  const label = `${days}d`;
  const stats = [
    {
      label: `Entregas (${label})`,
      value: total.toLocaleString("es-ES"),
      delta: deltaEntregas,
      footnote: `vs ${label} previos`,
    },
    {
      label: `En reparto hoy`,
      value: current.en_reparto_hoy.toLocaleString("es-ES"),
      delta: 0,
      footnote: `Driver_received + Assigned`,
      hideDelta: true,
    },
    {
      label: `% AA (${label})`,
      value: `${aaPct.toFixed(1)}%`,
      delta: 0,
      footnote: `${aa} entregas AA`,
      hideDelta: true,
    },
  ];

  return (
    <>
      {stats.map((s) => (
        <Card className="shadow-none" key={s.label}>
          <CardHeader>
            <CardTitle className="font-normal text-muted-foreground text-xs">
              {s.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="font-semibold text-2xl tabular-nums">{s.value}</p>
            <div className="flex items-center gap-1 text-xs">
              {!s.hideDelta && (
                <Delta value={s.delta}>
                  <DeltaIcon />
                  <DeltaValue />
                </Delta>
              )}
              <span className="text-muted-foreground">{s.footnote}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

/* ---------------- Entregas por día ---------------- */

function EntregasPorDia({
  byDay,
  from,
  to,
}: {
  byDay: DayAgg[];
  from: Date;
  to: Date;
}) {
  const data = useMemo(() => {
    const buckets = new Map<string, DayAgg>();
    const days = differenceInCalendarDays(to, from);
    for (let i = 0; i <= days; i++) {
      const k = toISO(addDays(from, i));
      buckets.set(k, { fecha: k, entregados: 0, incidencias: 0, en_reparto: 0, total: 0 });
    }
    for (const r of byDay) {
      if (buckets.has(r.fecha)) buckets.set(r.fecha, r);
    }
    return Array.from(buckets.values());
  }, [byDay, from, to]);

  const config = {
    entregados: { label: "Entregados", color: "var(--chart-2)" },
    en_reparto: { label: "En reparto", color: "var(--chart-1)" },
    incidencias: { label: "Incidencias", color: "var(--destructive)" },
  } satisfies ChartConfig;

  function EntregasTooltip({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string; dataKey: string; payload?: DayAgg }>;
    label?: string;
  }) {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0]?.payload;
    const total = row?.total ?? 0;
    return (
      <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
        <p className="mb-1 font-medium text-foreground">
          {format(parseISO(label!), "d MMM yyyy", { locale: es })}
        </p>
        <div className="space-y-1">
          {payload.map((p) => {
            const pct = total > 0 ? ((p.value as number) / total) * 100 : 0;
            return (
              <div key={p.dataKey} className="flex items-center gap-2">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: p.color }}
                />
                <span className="flex-1 text-muted-foreground">{p.name}</span>
                <span className="font-medium tabular-nums">{p.value}</span>
                <span className="tabular-nums text-muted-foreground">
                  ({pct.toFixed(1)}%)
                </span>
              </div>
            );
          })}
          <div className="mt-1 flex items-center justify-between border-t pt-1 text-xs text-muted-foreground">
            <span>Total</span>
            <span className="font-medium tabular-nums">{total}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className="shadow-none sm:col-span-2 lg:col-span-2">
      <CardHeader>
        <CardTitle>Entregas por día</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer className="h-[220px] w-full" config={config}>
          <LineChart data={data} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="fecha"
              tickFormatter={(v: string) => v.slice(5)}
              tickLine={false}
              axisLine={false}
              fontSize={11}
            />
            <YAxis tickLine={false} axisLine={false} fontSize={11} width={28} />
            <ChartTooltip content={<EntregasTooltip />} />
            <Line
              type="monotone"
              dataKey="entregados"
              stroke="var(--color-entregados)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="en_reparto"
              stroke="var(--color-en_reparto)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="incidencias"
              stroke="var(--color-incidencias)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: "var(--chart-2)" }}
            />
            <span className="text-muted-foreground">Entregados</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: "var(--chart-1)" }}
            />
            <span className="text-muted-foreground">En reparto</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: "var(--destructive)" }}
            />
            <span className="text-muted-foreground">Incidencias</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Tipo de entrega ---------------- */

const TIPO_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function TipoEntrega({ byTipo }: { byTipo: TipoAgg[] }) {
  const total = useMemo(() => byTipo.reduce((s, d) => s + d.n, 0), [byTipo]);
  const data = useMemo(
    () =>
      byTipo.map((d, i) => ({
        tipo: d.tipo,
        n: d.n,
        pct: total > 0 ? (d.n / total) * 100 : 0,
        fill: TIPO_COLORS[i % TIPO_COLORS.length],
      })),
    [byTipo, total],
  );

  const pctFor = (key: string) =>
    data.find((d) => d.tipo === key)?.pct ?? 0;
  const toDoorPct = pctFor("TO_DOOR");
  const pudoPct = pctFor("PUDO");

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Tipo de entrega</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer className="h-[220px] w-full" config={{}}>
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="tipo" />} />
            <Pie data={data} dataKey="n" nameKey="tipo" innerRadius={45} strokeWidth={2}>
              {data.map((d) => (
                <Cell key={d.tipo} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase text-muted-foreground">% TO_DOOR</span>
            <span className="font-semibold text-lg tabular-nums">{toDoorPct.toFixed(1)}%</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase text-muted-foreground">% PUDO</span>
            <span className="font-semibold text-lg tabular-nums">{pudoPct.toFixed(1)}%</span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {data.map((d) => (
            <span key={d.tipo} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: d.fill }}
              />
              <span className="text-muted-foreground">{d.tipo}</span>
              <span className="font-medium tabular-nums">{d.n}</span>
              <span className="text-muted-foreground tabular-nums">({d.pct.toFixed(1)}%)</span>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Dashboard ---------------- */

const PRESETS: { label: string; days: number }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

const EMPTY_STATS: DashStats = { total: 0, aa: 0, en_reparto_hoy: 0, by_day: [], by_tipo: [] };

export function Dashboard() {
  const { hubs } = useAuth();
  const queryClient = useQueryClient();

  const [hubFilter, setHubFilter] = useState<string>("all");
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const today = new Date();
    return { from: subDays(today, 29), to: today };
  });

  const allHubIds = useMemo(() => hubs.map((h) => h.id), [hubs]);
  const activeHubIds = hubFilter === "all" ? allHubIds : [hubFilter];

  const from = range?.from ?? subDays(new Date(), 29);
  const to = range?.to ?? from;
  const days = differenceInCalendarDays(to, from) + 1;
  const prevFrom = subDays(from, days);
  const prevTo = subDays(from, 1);

  const currentQ = useDashStats(activeHubIds, toISO(from), toISO(to));
  const prevQ = useDashStats(activeHubIds, toISO(prevFrom), toISO(prevTo));

  useEffect(() => {
    if (allHubIds.length === 0) return;
    const channel = supabase
      .channel(`entregas-dash`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entregas" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { hub_id?: string } | null;
          if (row?.hub_id && allHubIds.includes(row.hub_id)) {
            queryClient.invalidateQueries({ queryKey: ["dash-stats"] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [allHubIds, queryClient]);

  if (hubs.length === 0) {
    return (
      <Card className="shadow-none">
        <CardContent className="p-6 text-sm text-muted-foreground">
          No tienes hubs asignados.
        </CardContent>
      </Card>
    );
  }

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["dash-stats"] });

  const applyPreset = (d: number) => {
    const today = new Date();
    setRange({ from: subDays(today, d - 1), to: today });
  };

  const rangeLabel =
    range?.from && range.to
      ? `${format(range.from, "d MMM", { locale: es })} – ${format(range.to, "d MMM yyyy", { locale: es })}`
      : "Selecciona fechas";

  const selectedHubLabel =
    hubFilter === "all"
      ? `Todos los hubs (${hubs.length})`
      : (() => {
          const h = hubs.find((x) => x.id === hubFilter);
          return h ? `${h.marca} · ${h.nombre}` : "Hub";
        })();

  const current = currentQ.data ?? EMPTY_STATS;
  const previous = prevQ.data ?? EMPTY_STATS;
  const loading = currentQ.isLoading || currentQ.isFetching;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 max-w-[240px]">
              <span className="truncate">{selectedHubLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1" align="end">
            <button
              type="button"
              onClick={() => setHubFilter("all")}
              className={cn(
                "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                hubFilter === "all" && "bg-accent",
              )}
            >
              <span>Todos los hubs</span>
              <span className="text-xs text-muted-foreground">{hubs.length}</span>
            </button>
            <div className="my-1 h-px bg-border" />
            <div className="max-h-64 overflow-auto">
              {hubs.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setHubFilter(h.id)}
                  className={cn(
                    "flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                    hubFilter === h.id && "bg-accent",
                  )}
                >
                  <span className="truncate">{h.marca} · {h.nombre}</span>
                  {h.ciudad && (
                    <span className="text-[10px] text-muted-foreground">{h.ciudad}</span>
                  )}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <div className="flex items-center gap-1">
          {PRESETS.map((p) => (
            <Button
              key={p.days}
              variant={days === p.days ? "default" : "outline"}
              size="sm"
              onClick={() => applyPreset(p.days)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarIcon className="h-3.5 w-3.5" />
              {rangeLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={range}
              onSelect={setRange}
              locale={es}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="sm" onClick={refresh} className="gap-2" disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refrescar
        </Button>
      </div>
      <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3")}>
        <Stats current={current} previous={previous} days={days} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <EntregasPorDia byDay={current.by_day} from={from} to={to} />
        <TipoEntrega byTipo={current.by_tipo} />
      </div>
    </div>
  );
}
