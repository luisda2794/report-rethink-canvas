import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Users, MapPin } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// DSR = Entregados ÷ (Entregados + Attempt Failure) — sobre la fecha REAL del
// evento (tiempo_entrega/tiempo_fracaso, con fallback a "fecha" si el ePOD no
// las trajo), calculado en SQL por dashboard_dsr_stats() sobre epod_lineas.
// Ya no depende de subir un Excel: usa los hubs seleccionados en el Dashboard.
// ---------------------------------------------------------------------------

const DSR_GOAL = 90;
const DSR_MIN = 88;

function dsrColor(pct: number): string {
  if (pct >= DSR_GOAL) return "var(--success)";
  if (pct >= DSR_MIN) return "var(--warn)";
  return "var(--danger)";
}

type DayAgg = { fecha: string; delivered: number; failed: number };
type CpAgg = { cp: string; delivered: number; failed: number };
type DriverAgg = { driver: string; delivered: number; failed: number };
type DsrStatsResponse = { trend: DayAgg[]; by_cp: CpAgg[]; by_driver: DriverAgg[] };

function useDsrStats(hubIds: string[], includeWeekends: boolean) {
  return useQuery({
    queryKey: ["dashboard-dsr-stats", hubIds.slice().sort().join(","), includeWeekends],
    enabled: hubIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<DsrStatsResponse> => {
      const { data, error } = await supabase.rpc("dashboard_dsr_stats", {
        _hub_ids: hubIds,
        _include_weekends: includeWeekends,
      });
      if (error) throw error;
      const d = (data ?? {}) as Partial<DsrStatsResponse>;
      return { trend: d.trend ?? [], by_cp: d.by_cp ?? [], by_driver: d.by_driver ?? [] };
    },
  });
}

type DayPoint = { fecha: string; label: string; dsr: number | null; delivered: number; failed: number; total: number };
type Rank = { key: string; delivered: number; failed: number; total: number; dsr: number };

function toTrendPoints(trend: DayAgg[]): DayPoint[] {
  return trend.map((d) => {
    const total = d.delivered + d.failed;
    return {
      fecha: d.fecha,
      label: d.fecha.slice(5),
      dsr: total > 0 ? (d.delivered / total) * 100 : null,
      delivered: d.delivered,
      failed: d.failed,
      total,
    };
  });
}

function rankFrom<T extends { delivered: number; failed: number }>(rows: T[], keyOf: (r: T) => string): Rank[] {
  return rows
    .map((r) => {
      const total = r.delivered + r.failed;
      return { key: keyOf(r), delivered: r.delivered, failed: r.failed, total, dsr: total > 0 ? (r.delivered / total) * 100 : 0 };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => a.dsr - b.dsr)
    .slice(0, 8);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DsrDot(props: any) {
  const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: DayPoint };
  if (cx == null || cy == null || !payload || payload.dsr == null) return <g />;
  const color = dsrColor(payload.dsr);
  return <circle cx={cx} cy={cy} r={4} fill={color} stroke={color} />;
}

function DsrTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DayPoint }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-foreground">{p.label}</p>
      {p.dsr == null ? (
        <p className="text-muted-foreground text-xs">Sin datos ese día</p>
      ) : (
        <>
          <p className="tabular-nums" style={{ color: dsrColor(p.dsr) }}>
            DSR {p.dsr.toFixed(1)}%
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {p.delivered}/{p.total} entregados
          </p>
        </>
      )}
    </div>
  );
}

function RankBar({ rank }: { rank: Rank }) {
  const color = dsrColor(rank.dsr);
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 text-xs text-foreground truncate" title={rank.key}>
        {rank.key}
      </div>
      <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(0, Math.min(100, rank.dsr))}%`, backgroundColor: color }}
        />
      </div>
      <div className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums" style={{ color }}>
        {rank.dsr.toFixed(1)}%
      </div>
      <div className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {rank.delivered}/{rank.total}
      </div>
    </div>
  );
}

function RankCard({
  title,
  icon,
  ranks,
  emptyLabel,
}: {
  title: string;
  icon: ReactNode;
  ranks: Rank[];
  emptyLabel: string;
}) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ranks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {ranks.map((r) => (
              <RankBar key={r.key} rank={r} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const chartConfig = {
  dsr: { label: "DSR", color: "var(--electric)" },
} satisfies ChartConfig;

export function DashboardDsrWidgets({ hubIds }: { hubIds: string[] }) {
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const { data, isLoading, isError, error } = useDsrStats(hubIds, includeWeekends);

  const trend = useMemo(() => toTrendPoints(data?.trend ?? []), [data]);
  const cpRanking = useMemo(() => rankFrom(data?.by_cp ?? [], (r) => r.cp), [data]);
  const driverRanking = useMemo(() => rankFrom(data?.by_driver ?? [], (r) => r.driver), [data]);

  const globalDelivered = trend.reduce((s, t) => s + t.delivered, 0);
  const globalTotal = trend.reduce((s, t) => s + t.total, 0);
  const globalDsr = globalTotal > 0 ? (globalDelivered / globalTotal) * 100 : 0;

  if (hubIds.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" /> Tendencia de DSR (14 días)
            </span>
            <label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              Incluir fines de semana
              <Switch checked={includeWeekends} onCheckedChange={setIncludeWeekends} />
            </label>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isError ? (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "No se pudo cargar el DSR."}
            </p>
          ) : isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : globalTotal === 0 ? (
            <p className="text-sm text-muted-foreground">Sin entregas/fallos en los últimos 14 días para este hub.</p>
          ) : (
            <>
              <ChartContainer className="h-[220px] w-full" config={chartConfig}>
                <LineChart data={trend} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} width={32} />
                  <ChartTooltip content={<DsrTooltip />} />
                  <ReferenceLine y={DSR_GOAL} stroke="var(--success)" strokeDasharray="4 4" strokeOpacity={0.6} />
                  <ReferenceLine y={DSR_MIN} stroke="var(--warn)" strokeDasharray="4 4" strokeOpacity={0.6} />
                  <Line
                    type="monotone"
                    dataKey="dsr"
                    stroke="var(--color-dsr)"
                    strokeWidth={2}
                    dot={<DsrDot />}
                    connectNulls
                  />
                </LineChart>
              </ChartContainer>
              <div className="mt-3 flex items-center justify-between border-t pt-3">
                <span className="text-xs text-muted-foreground">DSR global del periodo</span>
                <span className="text-2xl font-semibold tabular-nums" style={{ color: dsrColor(globalDsr) }}>
                  {globalDsr.toFixed(1)}%
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankCard
          title="CPs problemáticos"
          icon={<MapPin className="size-4 text-primary" />}
          ranks={cpRanking}
          emptyLabel="Sin entregas/fallos en el periodo."
        />
        <RankCard
          title="Drivers problemáticos"
          icon={<Users className="size-4 text-primary" />}
          ranks={driverRanking}
          emptyLabel="Sin entregas/fallos en el periodo."
        />
      </div>
    </div>
  );
}
