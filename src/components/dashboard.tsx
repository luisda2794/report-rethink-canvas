import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CalendarIcon } from "lucide-react";
import { format, subDays, differenceInCalendarDays, addDays } from "date-fns";
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

type Entrega = {
  fecha: string | null;
  tipo_norm: string | null;
  tipo: string | null;
  es_aa: boolean | null;
  estado: string | null;
};

function useEntregas(hubId: string | null, fromISO: string, toISO: string) {
  return useQuery({
    queryKey: ["dash-entregas", hubId, fromISO, toISO],
    enabled: !!hubId,
    queryFn: async (): Promise<Entrega[]> => {
      const pageSize = 1000;
      const all: Entrega[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("entregas")
          .select("fecha, tipo_norm, tipo, es_aa, estado")
          .eq("hub_id", hubId!)
          .gte("fecha", fromISO)
          .lte("fecha", toISO)
          .order("fecha", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (data ?? []) as Entrega[];
        all.push(...rows);
        if (rows.length < pageSize) break;
      }
      return all;
    },
  });
}

/* ---------------- KPIs ---------------- */

function Stats({
  current,
  previous,
  days,
}: {
  current: Entrega[];
  previous: Entrega[];
  days: number;
}) {
  const total = current.length;
  const totalPrev = previous.length;
  const deltaEntregas =
    totalPrev > 0 ? ((total - totalPrev) / totalPrev) * 100 : 0;

  const aa = current.filter((e) => e.es_aa).length;
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
  entregas,
  from,
  to,
}: {
  entregas: Entrega[];
  from: Date;
  to: Date;
}) {
  const data = useMemo(() => {
    type Row = { fecha: string; entregados: number; incidencias: number };
    const buckets = new Map<string, Row>();
    const days = differenceInCalendarDays(to, from);
    for (let i = 0; i <= days; i++) {
      const k = toISO(addDays(from, i));
      buckets.set(k, { fecha: k, entregados: 0, incidencias: 0 });
    }
    const failStates = new Set([
      "Cancelar",
      "Attempt Failure",
      "Return_to_seller_success",
      "Return_to_seller_fail",
      "Driver_received_incidence",
    ]);
    for (const e of entregas) {
      if (!e.fecha) continue;
      const row = buckets.get(e.fecha);
      if (!row) continue;
      if (e.estado === "Entregado") row.entregados += 1;
      else if (e.estado && failStates.has(e.estado)) row.incidencias += 1;
    }
    return Array.from(buckets.values());
  }, [entregas, from, to]);

  const config = {
    entregados: { label: "Entregados", color: "var(--chart-2)" },
    incidencias: { label: "Incidencias", color: "var(--destructive)" },
  } satisfies ChartConfig;

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
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              type="monotone"
              dataKey="entregados"
              stroke="var(--color-entregados)"
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

function TipoEntrega({ entregas }: { entregas: Entrega[] }) {
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entregas) {
      const key = (e.tipo_norm || e.tipo || "OTRO").toUpperCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts, ([tipo, n], i) => ({
      tipo,
      n,
      fill: TIPO_COLORS[i % TIPO_COLORS.length],
    }));
  }, [entregas]);

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
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {data.map((d) => (
            <span key={d.tipo} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: d.fill }}
              />
              <span className="text-muted-foreground">{d.tipo}</span>
              <span className="font-medium tabular-nums">{d.n}</span>
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

export function Dashboard() {
  const { selectedHub } = useAuth();
  const queryClient = useQueryClient();
  const hubId = selectedHub?.id ?? null;

  const [range, setRange] = useState<DateRange | undefined>(() => {
    const today = new Date();
    return { from: subDays(today, 29), to: today };
  });

  const from = range?.from ?? subDays(new Date(), 29);
  const to = range?.to ?? from;
  const days = differenceInCalendarDays(to, from) + 1;
  const prevFrom = subDays(from, days);
  const prevTo = subDays(from, 1);

  const currentQ = useEntregas(hubId, toISO(from), toISO(to));
  const prevQ = useEntregas(hubId, toISO(prevFrom), toISO(prevTo));

  // Realtime: refresca cuando entran/actualizan filas en entregas para este hub
  useEffect(() => {
    if (!hubId) return;
    const channel = supabase
      .channel(`entregas-${hubId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entregas", filter: `hub_id=eq.${hubId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dash-entregas", hubId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [hubId, queryClient]);

  if (!selectedHub) {
    return (
      <Card className="shadow-none">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Selecciona un hub para ver las métricas.
        </CardContent>
      </Card>
    );
  }

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["dash-entregas", hubId] });

  const applyPreset = (d: number) => {
    const today = new Date();
    setRange({ from: subDays(today, d - 1), to: today });
  };

  const rangeLabel =
    range?.from && range.to
      ? `${format(range.from, "d MMM", { locale: es })} – ${format(range.to, "d MMM yyyy", { locale: es })}`
      : "Selecciona fechas";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
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
        <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          Refrescar
        </Button>
      </div>
      <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3")}>
        <Stats
          current={currentQ.data ?? []}
          previous={prevQ.data ?? []}
          days={days}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <EntregasPorDia entregas={currentQ.data ?? []} from={from} to={to} />
        <TipoEntrega entregas={currentQ.data ?? []} />
      </div>
    </div>
  );
}
