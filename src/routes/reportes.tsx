import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequireAuth } from "@/components/RequireAuth";
import { KpisRiesgoTab } from "@/components/kpis-riesgo-tab";
import { FlowMeetingPage } from "@/routes/reportes_.flow-meeting";
import { useAuth } from "@/contexts/AuthContext";
import { useCd5Trend, type Cd5DayPoint } from "@/lib/kpis-cd5";
import { useDsrTrend, KPIS_TREND_BUSINESS_DAYS, type DsrDayPoint } from "@/lib/kpis-dsr";
import { DSR_BANDS, dsrBandFor } from "@/lib/kpis-dsr-bands";
import { mostRecentBusinessDay, toIso } from "@/lib/business-days";

const MIN_HISTORY_DAYS_FOR_CD5 = 5;

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

  const cd5Points = cd5.data?.points ?? [];
  const dsrPoints = dsr.data ?? [];

  // "Hoy" real de calendario (no ajustado a hábil) — el día en curso, cuyos
  // datos todavía son parciales. Se excluye del DSR acumulado pero se sigue
  // mostrando en la tendencia como referencia visual.
  const todayReal = toIso(new Date());

  // Historial insuficiente para CD5 = menos de 5 días de span real de datos
  // — no es un bug, es que ningún waybill pudo llegar a 5 días de inbound
  // todavía. Se distingue de "esta métrica cargó pero el cohorte de este día
  // puntual dio vacío", que es un estado normal y esperable día a día.
  const cd5History = cd5.data;
  const cd5HistorySpanDays =
    cd5History?.earliestFecha && cd5History?.latestFecha
      ? Math.round((Date.parse(cd5History.latestFecha) - Date.parse(cd5History.earliestFecha)) / 86_400_000)
      : null;
  const cd5InsufficientHistory = cd5HistorySpanDays != null && cd5HistorySpanDays < MIN_HISTORY_DAYS_FOR_CD5;

  // Día mostrado en la tarjeta grande de CD5: el hábil más reciente con
  // cohorte, retrocediendo desde hoy (ajustado a hábil) si hace falta.
  const today = toIso(mostRecentBusinessDay());
  const shownCd5 = useMemo(() => {
    for (let i = cd5Points.length - 1; i >= 0; i--) {
      if (cd5Points[i].total > 0) return cd5Points[i];
    }
    return null;
  }, [cd5Points]);

  // DSR acumulado: promedio ponderado (mismo criterio que "DSR global del
  // periodo" en el Dashboard) de todos los días hábiles de la tendencia,
  // EXCLUYENDO hoy porque el día todavía no cerró — incluirlo distorsiona el
  // resultado con datos parciales (ya pasó antes con otras métricas).
  const dsrAccumulated = useMemo(() => {
    const closed = dsrPoints.filter((p) => p.fecha !== todayReal);
    const delivered = closed.reduce((s, p) => s + p.delivered, 0);
    const total = closed.reduce((s, p) => s + p.total, 0);
    return { delivered, total, dsr: total > 0 ? (delivered / total) * 100 : null, dias: closed.length };
  }, [dsrPoints, todayReal]);

  const isLoading = cd5.isLoading || dsr.isLoading;
  const isError = cd5.isError || dsr.isError;
  const isCd5Fallback = shownCd5 != null && shownCd5.fecha !== today;
  const hasAnyData = shownCd5 != null || dsrAccumulated.total > 0;

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
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Calculando CD5 y DSR — puede tardar unos segundos en hubs con mucho histórico…
        </div>
      ) : !hasAnyData ? (
        <p className="text-sm text-muted-foreground">Sin actividad en los últimos {KPIS_TREND_BUSINESS_DAYS} días hábiles para este hub.</p>
      ) : (
        <>
          {isCd5Fallback && (
            <p className="text-xs text-muted-foreground border-l-2 border-muted-foreground/30 pl-3">
              CD5: mostrando {longLabel(shownCd5!.fecha)} — el hub no tuvo cohorte
              {" "}{today !== todayReal ? "el fin de semana" : "en el día hábil más reciente"}.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {cd5InsufficientHistory ? (
              <Cd5InsufficientHistoryCard spanDays={cd5HistorySpanDays ?? 0} />
            ) : (
              <Cd5Card day={shownCd5} />
            )}
            <DsrAccumuladoCard result={dsrAccumulated} businessDays={KPIS_TREND_BUSINESS_DAYS} />
          </div>

          <DsrBandTable />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Cd5TrendCard points={cd5Points} insufficientHistory={cd5InsufficientHistory} />
            <DsrTrendCard points={dsrPoints} todayReal={todayReal} />
          </div>
        </>
      )}

      <Tabs defaultValue="riesgo">
        <TabsList>
          <TabsTrigger value="riesgo">Paquetes en Riesgo</TabsTrigger>
          <TabsTrigger value="flow">Flow Meeting</TabsTrigger>
        </TabsList>
        <TabsContent value="riesgo" className="mt-4">
          <KpisRiesgoTab hubId={hubId} hubMarca={selectedHub?.marca ?? "hub"} />
        </TabsContent>
        <TabsContent value="flow" className="mt-4">
          <FlowMeetingPage embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// TARJETAS GRANDES
// ============================================================

function Cd5Card({ day }: { day: Cd5DayPoint | null }) {
  const pct = day?.pct ?? null;
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>CD5 de hoy</CardTitle>
      </CardHeader>
      <CardContent>
        {!day || pct == null ? (
          <p className="text-sm text-muted-foreground">Sin cohorte ese día (ningún waybill con 5+ días de inbound).</p>
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

function Cd5InsufficientHistoryCard({ spanDays }: { spanDays: number }) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>CD5 de hoy</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          No hay suficiente histórico para calcular CD5 de este hub — se necesitan al menos{" "}
          {MIN_HISTORY_DAYS_FOR_CD5} días de datos y por ahora hay {spanDays === 0 ? "menos de 1" : spanDays}.
        </p>
      </CardContent>
    </Card>
  );
}

type DsrAccumulatedResult = { delivered: number; total: number; dsr: number | null; dias: number };

function DsrAccumuladoCard({ result, businessDays }: { result: DsrAccumulatedResult; businessDays: number }) {
  if (result.total === 0 || result.dsr == null) {
    return (
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>DSR Acumulado</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Sin entregas/fallos cerrados en el periodo (sin contar hoy).</p>
        </CardContent>
      </Card>
    );
  }
  const band = dsrBandFor(result.dsr);
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>DSR Acumulado</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-3">
          <div className="text-4xl font-semibold tabular-nums" style={{ color: band.color }}>
            {result.dsr.toFixed(1)}%
          </div>
          <span
            className="px-2 py-0.5 rounded text-xs font-semibold tabular-nums"
            style={{ color: band.color, backgroundColor: `color-mix(in oklch, ${band.color} 15%, transparent)` }}
          >
            {band.pctKpi}% de KPIs
          </span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
          {result.delivered}/{result.total} entregados · últimos {result.dias} de {businessDays} días hábiles (sin contar hoy)
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
  const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: DsrDayPoint & { enCurso?: boolean } };
  if (cx == null || cy == null || !payload || payload.dsr == null) return <g />;
  const color = dsrBandFor(payload.dsr).color;
  // Hoy (día en curso, no cuenta en el DSR acumulado) se marca hueco en vez
  // de relleno, para distinguirlo visualmente sin ocultarlo de la tendencia.
  if (payload.enCurso) {
    return <circle cx={cx} cy={cy} r={4} fill="var(--background)" stroke={color} strokeWidth={2} />;
  }
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

function DsrTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: DsrDayPoint & { enCurso?: boolean } }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-foreground">
        {tooltipLabel(p.fecha)}
        {p.enCurso && <span className="ml-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">En curso</span>}
      </p>
      {p.dsr == null ? (
        <p className="text-muted-foreground text-xs">Sin datos ese día</p>
      ) : (
        <>
          <p className="tabular-nums" style={{ color: dsrBandFor(p.dsr).color }}>
            DSR {p.dsr.toFixed(1)}% · {dsrBandFor(p.dsr).pctKpi}% de KPIs
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">{p.delivered}/{p.total} entregados</p>
          {p.enCurso && <p className="text-[11px] text-muted-foreground/80 mt-1">No cuenta en el DSR acumulado (día sin cerrar).</p>}
        </>
      )}
    </div>
  );
}

function Cd5TrendCard({ points, insufficientHistory }: { points: Cd5DayPoint[]; insufficientHistory: boolean }) {
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
        {insufficientHistory ? (
          <p className="text-sm text-muted-foreground">
            No hay suficiente histórico para calcular CD5 — se necesitan al menos {MIN_HISTORY_DAYS_FOR_CD5} días de datos.
          </p>
        ) : !hasData ? (
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

function DsrTrendCard({ points, todayReal }: { points: DsrDayPoint[]; todayReal: string }) {
  const chartData = points.map((p) => ({ ...p, label: axisLabel(p.fecha), enCurso: p.fecha === todayReal }));
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
