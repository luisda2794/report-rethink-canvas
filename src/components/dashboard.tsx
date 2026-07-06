import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import CD5HeatMap from "@/components/mapas/cd5-heat-map";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

type Entrega = {
  fecha: string | null;
  tipo_norm: string | null;
  tipo: string | null;
  es_aa: boolean | null;
  estado: string | null;
};

type Reclamacion = {
  estado: string | null;
  importe: number | null;
  fecha_entrega: string | null;
};

function useDashboardData() {
  const { selectedHub } = useAuth();
  const hubId = selectedHub?.id ?? null;

  const since30 = daysAgo(30);
  const since60 = daysAgo(60);

  const entregasQ = useQuery({
    queryKey: ["dash-entregas", hubId, since60],
    enabled: !!hubId,
    queryFn: async (): Promise<Entrega[]> => {
      const pageSize = 1000;
      const all: Entrega[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("entregas")
          .select("fecha, tipo_norm, tipo, es_aa, estado")
          .eq("hub_id", hubId!)
          .gte("fecha", since60)
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

  const reclamacionesQ = useQuery({
    queryKey: ["dash-reclamaciones", hubId],
    enabled: !!hubId,
    queryFn: async (): Promise<Reclamacion[]> => {
      const { data, error } = await supabase
        .from("reclamaciones")
        .select("estado, importe, fecha_entrega")
        .eq("hub_id", hubId!)
        .gte("fecha_entrega", since60);
      if (error) throw error;
      return (data ?? []) as Reclamacion[];
    },
  });

  return { entregasQ, reclamacionesQ, since30 };
}

/* ---------------- KPIs ---------------- */

function Stats() {
  const { entregasQ, reclamacionesQ, since30 } = useDashboardData();
  const entregas = entregasQ.data ?? [];
  const reclamaciones = reclamacionesQ.data ?? [];

  const last30 = entregas.filter((e) => (e.fecha ?? "") >= since30);
  const prev30 = entregas.filter((e) => (e.fecha ?? "") < since30);

  const total30 = last30.length;
  const totalPrev = prev30.length;
  const deltaEntregas =
    totalPrev > 0 ? ((total30 - totalPrev) / totalPrev) * 100 : 0;

  const aa30 = last30.filter((e) => e.es_aa).length;
  const aaPct = total30 ? (aa30 / total30) * 100 : 0;

  const recPend = reclamaciones.filter(
    (r) => (r.estado ?? "").toLowerCase() === "pendiente",
  ).length;

  const stats = [
    {
      label: "Entregas (30d)",
      value: total30.toLocaleString("es-ES"),
      delta: deltaEntregas,
      footnote: "vs 30d previos",
      hideDelta: false,
    },
    {
      label: "% AA (30d)",
      value: `${aaPct.toFixed(1)}%`,
      delta: 0,
      footnote: `${aa30} entregas AA`,
      hideDelta: true,
    },
    {
      label: "Reclamaciones pendientes",
      value: recPend.toLocaleString("es-ES"),
      delta: 0,
      footnote: "abiertas ahora",
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

function EntregasPorDia() {
  const { entregasQ, since30 } = useDashboardData();
  const data = useMemo(() => {
    const buckets = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const e of entregasQ.data ?? []) {
      if (!e.fecha || e.fecha < since30) continue;
      if (buckets.has(e.fecha)) buckets.set(e.fecha, buckets.get(e.fecha)! + 1);
    }
    return Array.from(buckets, ([fecha, n]) => ({ fecha, n }));
  }, [entregasQ.data, since30]);

  const config = {
    n: { label: "Entregas", color: "var(--chart-1)" },
  } satisfies ChartConfig;

  return (
    <Card className="shadow-none sm:col-span-2 lg:col-span-2">
      <CardHeader>
        <CardTitle>Entregas por día (30d)</CardTitle>
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
              dataKey="n"
              stroke="var(--color-n)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
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

function TipoEntrega() {
  const { entregasQ, since30 } = useDashboardData();
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entregasQ.data ?? []) {
      if (!e.fecha || e.fecha < since30) continue;
      const key = (e.tipo_norm || e.tipo || "OTRO").toUpperCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts, ([tipo, n], i) => ({
      tipo,
      n,
      fill: TIPO_COLORS[i % TIPO_COLORS.length],
    }));
  }, [entregasQ.data, since30]);

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Tipo de entrega (30d)</CardTitle>
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

/* ---------------- Reclamaciones por estado ---------------- */

function ReclamacionesEstado() {
  const { reclamacionesQ } = useDashboardData();
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reclamacionesQ.data ?? []) {
      const k = (r.estado ?? "sin estado").toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts, ([estado, n]) => ({ estado, n }));
  }, [reclamacionesQ.data]);

  const config = {
    n: { label: "Reclamaciones", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Reclamaciones por estado (60d)</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer className="h-[220px] w-full" config={config}>
          <BarChart data={data} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="estado" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis tickLine={false} axisLine={false} fontSize={11} width={28} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="n" fill="var(--color-n)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

/* ---------------- Mapa CD5 ---------------- */

async function fetchCD5Snapshot() {
  const res = await fetch("/api/public/cd5");
  if (!res.ok) throw new Error("No se pudo cargar CD5");
  return res.json();
}

function MapaCD5Card() {
  return (
    <Card className="shadow-none sm:col-span-2 lg:col-span-3">
      <CardHeader>
        <CardTitle>Mapa de calor CD5</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="h-[360px] w-full overflow-hidden rounded-b-lg">
          <CD5HeatMap fetchCD5Snapshot={fetchCD5Snapshot} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Dashboard ---------------- */

export function Dashboard() {
  const { selectedHub } = useAuth();

  if (!selectedHub) {
    return (
      <Card className="shadow-none">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Selecciona un hub para ver las métricas.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3")}>
        <Stats />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <EntregasPorDia />
        <TipoEntrega />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MapaCD5Card />
        <ReclamacionesEstado />
      </div>
    </div>
  );
}
