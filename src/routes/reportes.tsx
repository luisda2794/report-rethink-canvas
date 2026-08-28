import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { AlertTriangle, Copy, MapPin, Sparkles, TrendingUp, Users } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { RequireAuth } from "@/components/RequireAuth";
import { ReportCard } from "@/components/ReportCard";
import { useAuth } from "@/contexts/AuthContext";
import { useCd5Trend, type Cd5DayPoint } from "@/lib/kpis-cd5";
import { useDsrTrend, KPIS_TREND_BUSINESS_DAYS, type DsrDayPoint } from "@/lib/kpis-dsr";
import { DSR_BANDS, dsrBandFor } from "@/lib/kpis-dsr-bands";
import { mostRecentBusinessDay, toIso } from "@/lib/business-days";

export const Route = createFileRoute("/reportes")({
  component: () => (
    <RequireAuth path="/reportes">
      <KpisPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — KPIs" },
      {
        name: "description",
        content: "CD5 y DSR diarios del hub, solo de lunes a viernes.",
      },
    ],
  }),
});

// --- CD5: target 99.5%, semáforo estándar (más alto = mejor) ---
const CD5_TARGET = 99.5;
function cd5Color(pct: number): string {
  if (pct >= 99.5) return "var(--success)";
  if (pct >= 95) return "var(--warn)";
  return "var(--danger)";
}

function esDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("es-ES", opts);
}
const axisLabel = (iso: string) => esDate(iso, { day: "2-digit", month: "2-digit" });
const tooltipLabel = (iso: string) => esDate(iso, { weekday: "short", day: "numeric", month: "short" });
const longLabel = (iso: string) => esDate(iso, { weekday: "long", day: "numeric", month: "long" });

function KpisPage() {
  const { selectedHub } = useAuth();
  const hubId = selectedHub?.id ?? null;

  const cd5 = useCd5Trend(hubId, KPIS_TREND_BUSINESS_DAYS);
  const dsr = useDsrTrend(hubId, KPIS_TREND_BUSINESS_DAYS);

  const cd5Points = cd5.data ?? [];
  const dsrByFecha = useMemo(() => new Map((dsr.data ?? []).map((p) => [p.fecha, p])), [dsr.data]);

  // Día mostrado en las tarjetas grandes: el hábil más reciente con datos en
  // CUALQUIERA de las dos métricas, retrocediendo desde hoy (ajustado a
  // hábil) si hace falta.
  const today = toIso(mostRecentBusinessDay());
  const shown = useMemo(() => {
    for (let i = cd5Points.length - 1; i >= 0; i--) {
      const c = cd5Points[i];
      const d = dsrByFecha.get(c.fecha);
      if (c.total > 0 || (d && d.total > 0)) {
        return { fecha: c.fecha, cd5: c, dsr: d ?? null };
      }
    }
    return null;
  }, [cd5Points, dsrByFecha]);

  const isLoading = cd5.isLoading || dsr.isLoading;
  const isError = cd5.isError || dsr.isError;
  const isWeekendFallback = shown != null && shown.fecha !== today;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">KPIs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          CD5 y DSR para <span className="text-foreground font-semibold">{selectedHub?.marca ?? "—"}</span>, solo de lunes a viernes.
        </p>
      </div>

      {!selectedHub ? (
        <p className="text-sm text-muted-foreground">Selecciona un hub para ver sus KPIs.</p>
      ) : isError ? (
        <p className="text-sm text-destructive">No se pudieron cargar los KPIs de este hub.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : !shown ? (
        <p className="text-sm text-muted-foreground">Sin actividad en los últimos {KPIS_TREND_BUSINESS_DAYS} días hábiles para este hub.</p>
      ) : (
        <>
          {isWeekendFallback && (
            <p className="text-xs text-muted-foreground border-l-2 border-muted-foreground/30 pl-3">
              Mostrando {longLabel(shown.fecha)} — el hub no tuvo actividad
              {" "}{today !== toIso(new Date()) ? "el fin de semana" : "en el día hábil más reciente"}.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Cd5Card day={shown.cd5} />
            <DsrCard day={shown.dsr} />
          </div>

          <DsrBandTable />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Cd5TrendCard points={cd5Points} />
            <DsrTrendCard points={dsr.data ?? []} />
          </div>
        </>
      )}

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">Otros reportes</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ReportCard
            to="/reportes/paquetes-en-riesgo"
            icon={AlertTriangle}
            title="Paquetes en Riesgo"
            description="Paquetes en reparto que rompen CD5 (5+ días desde inbound)."
          />
          <ReportCard
            to="/reportes/flow-meeting"
            icon={Users}
            title="Flow Meeting"
            description="Dashboard de la reunión de flujo: KPIs, drivers, CPs e incidencias del día."
          />
          <ReportCard
            to="/duplicados"
            icon={Copy}
            title="Duplicados"
            description="Detección de paquetes duplicados en el ePOD y tasas reales vs. Cainiao."
          />
          <ReportCard
            to="/reportes/super-reporte"
            icon={Sparkles}
            title="Súper Reporte"
            description="Entregas por categoría, CD5/CD13 y CD3 en un solo reporte."
          />
          <ReportCard
            to="/reportes/clientes-locales"
            icon={MapPin}
            title="Clientes Locales"
            description="Clientes locales en reparto, flow meeting por CP y CD4."
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TARJETAS GRANDES
// ============================================================

function Cd5Card({ day }: { day: Cd5DayPoint }) {
  const pct = day.pct;
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>CD5 de hoy</CardTitle>
      </CardHeader>
      <CardContent>
        {pct == null ? (
          <p className="text-sm text-muted-foreground">Sin cohorte ese día (ningún waybill cumplió 5 días de inbound).</p>
        ) : (
          <>
            <div className="text-4xl font-semibold tabular-nums" style={{ color: cd5Color(pct) }}>
              {pct.toFixed(1)}%
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
              {day.resueltos}/{day.total} resueltos a tiempo · target {CD5_TARGET}%
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DsrCard({ day }: { day: DsrDayPoint | null }) {
  if (!day || day.total === 0 || day.dsr == null) {
    return (
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>DSR de hoy</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Sin entregas/fallos ese día.</p>
        </CardContent>
      </Card>
    );
  }
  const band = dsrBandFor(day.dsr);
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>DSR de hoy</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-3">
          <div className="text-4xl font-semibold tabular-nums" style={{ color: band.color }}>
            {day.dsr.toFixed(1)}%
          </div>
          <span
            className="px-2 py-0.5 rounded text-xs font-semibold tabular-nums"
            style={{ color: band.color, backgroundColor: `color-mix(in oklch, ${band.color} 15%, transparent)` }}
          >
            {band.pctKpi}% de KPIs
          </span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
          {day.delivered}/{day.total} entregados
        </p>
      </CardContent>
    </Card>
  );
}

function DsrBandTable() {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-sm">Bandas de cumplimiento DSR</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-px bg-border rounded-md overflow-hidden text-sm">
          {DSR_BANDS.map((b) => (
            <div key={b.label} className="bg-card p-3 text-center">
              <div className="text-xs text-muted-foreground">{b.label}</div>
              <div className="mt-1 font-semibold tabular-nums" style={{ color: b.color }}>
                {b.pctKpi}%
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// TENDENCIAS
// ============================================================

const cd5ChartConfig = { pct: { label: "CD5", color: "var(--electric)" } } satisfies ChartConfig;
const dsrChartConfig = { dsr: { label: "DSR", color: "var(--electric)" } } satisfies ChartConfig;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Cd5Dot(props: any) {
  const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: Cd5DayPoint };
  if (cx == null || cy == null || !payload || payload.pct == null) return <g />;
  const color = cd5Color(payload.pct);
  return <circle cx={cx} cy={cy} r={4} fill={color} stroke={color} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DsrDot(props: any) {
  const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: DsrDayPoint };
  if (cx == null || cy == null || !payload || payload.dsr == null) return <g />;
  const color = dsrBandFor(payload.dsr).color;
  return <circle cx={cx} cy={cy} r={4} fill={color} stroke={color} />;
}

function Cd5Tooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Cd5DayPoint }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-foreground">{tooltipLabel(p.fecha)}</p>
      {p.pct == null ? (
        <p className="text-muted-foreground text-xs">Sin cohorte ese día</p>
      ) : (
        <>
          <p className="tabular-nums" style={{ color: cd5Color(p.pct) }}>CD5 {p.pct.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground tabular-nums">{p.resueltos}/{p.total} resueltos</p>
        </>
      )}
    </div>
  );
}

function DsrTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DsrDayPoint }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-foreground">{tooltipLabel(p.fecha)}</p>
      {p.dsr == null ? (
        <p className="text-muted-foreground text-xs">Sin datos ese día</p>
      ) : (
        <>
          <p className="tabular-nums" style={{ color: dsrBandFor(p.dsr).color }}>
            DSR {p.dsr.toFixed(1)}% · {dsrBandFor(p.dsr).pctKpi}% de KPIs
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">{p.delivered}/{p.total} entregados</p>
        </>
      )}
    </div>
  );
}

function Cd5TrendCard({ points }: { points: Cd5DayPoint[] }) {
  const chartData = points.map((p) => ({ ...p, label: axisLabel(p.fecha) }));
  const hasData = points.some((p) => p.total > 0);
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="size-4 text-primary" /> Tendencia CD5 ({KPIS_TREND_BUSINESS_DAYS} días hábiles)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-sm text-muted-foreground">Sin cohortes en el periodo.</p>
        ) : (
          <ChartContainer className="h-[220px] w-full" config={cd5ChartConfig}>
            <LineChart data={chartData} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} width={32} />
              <ChartTooltip content={<Cd5Tooltip />} />
              <ReferenceLine y={CD5_TARGET} stroke="var(--success)" strokeDasharray="4 4" strokeOpacity={0.6} />
              <Line type="monotone" dataKey="pct" stroke="var(--color-pct)" strokeWidth={2} dot={<Cd5Dot />} connectNulls />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function DsrTrendCard({ points }: { points: DsrDayPoint[] }) {
  const chartData = points.map((p) => ({ ...p, label: axisLabel(p.fecha) }));
  const hasData = points.some((p) => p.total > 0);
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="size-4 text-primary" /> Tendencia DSR ({KPIS_TREND_BUSINESS_DAYS} días hábiles)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-sm text-muted-foreground">Sin entregas/fallos en el periodo.</p>
        ) : (
          <ChartContainer className="h-[220px] w-full" config={dsrChartConfig}>
            <LineChart data={chartData} margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} width={32} />
              <ChartTooltip content={<DsrTooltip />} />
              <ReferenceLine y={96} stroke="var(--success)" strokeDasharray="4 4" strokeOpacity={0.6} />
              <ReferenceLine y={94} stroke="var(--warn)" strokeDasharray="4 4" strokeOpacity={0.6} />
              <ReferenceLine y={91} stroke="var(--danger)" strokeDasharray="4 4" strokeOpacity={0.6} />
              <Line type="monotone" dataKey="dsr" stroke="var(--color-dsr)" strokeWidth={2} dot={<DsrDot />} connectNulls />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
