import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, X, AlertCircle, TrendingUp, Users } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { isDeliveredEstado, isFailedEstado, resolveEventDate } from "@/lib/resolve-event-date";

// ---------------------------------------------------------------------------
// Resolución de columnas (español / inglés) + fecha real del evento
// ---------------------------------------------------------------------------

const REQUIRED_ALIASES = {
  waybill: ["Número de Waybill", "Waybill Number"],
  fecha: ["Fecha de la tarea", "Task Date"],
  estado: ["Estado de la Tarea", "Task Status"],
  driver: ["Nombre del Repartidor", "Courier Name"],
} as const;
type RequiredField = keyof typeof REQUIRED_ALIASES;

// Fechas reales del evento (entrega/fallo) — opcionales: si el archivo no las
// trae, resolveEventDate() cae de vuelta en "Fecha de la tarea".
const OPTIONAL_DATE_ALIASES = {
  tiempoEntrega: ["Tiempo de Entrega", "Delivery Time"],
  tiempoFracaso: ["Tiempo del Fracaso de la Entrega", "Delivery Failure Time"],
} as const;
type OptionalDateField = keyof typeof OPTIONAL_DATE_ALIASES;

function resolveColumns(
  headers: string[],
):
  | { cols: Record<RequiredField, string>; optCols: Partial<Record<OptionalDateField, string>>; missing?: never }
  | { cols?: never; optCols?: never; missing: string[] } {
  const cols = {} as Record<RequiredField, string>;
  const missing: string[] = [];
  for (const field of Object.keys(REQUIRED_ALIASES) as RequiredField[]) {
    const aliases = REQUIRED_ALIASES[field];
    const found = aliases.find((a) => headers.includes(a));
    if (found) cols[field] = found;
    else missing.push(aliases.join(" / "));
  }
  if (missing.length > 0) return { missing };

  const optCols: Partial<Record<OptionalDateField, string>> = {};
  for (const field of Object.keys(OPTIONAL_DATE_ALIASES) as OptionalDateField[]) {
    const aliases = OPTIONAL_DATE_ALIASES[field];
    const found = aliases.find((a) => headers.includes(a));
    if (found) optCols[field] = found;
  }
  return { cols, optCols };
}

function parseFecha(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    const utcDays = Math.floor(v - 25569);
    const utcMs = utcDays * 86400 * 1000 + (v - Math.floor(v)) * 86400 * 1000;
    return new Date(utcMs);
  }
  const s = String(v).trim();
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

function dayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function isWeekday(ts: number): boolean {
  const day = new Date(ts).getUTCDay();
  return day !== 0 && day !== 6;
}

type RawRow = {
  waybill: string;
  fecha: Date | null;
  estado: string;
  driver: string;
};

const DSR_GOAL = 90;
const DSR_MIN = 88;

function dsrColor(pct: number): string {
  if (pct >= DSR_GOAL) return "var(--success)";
  if (pct >= DSR_MIN) return "var(--warn)";
  return "var(--danger)";
}

type DayPoint = {
  ts: number;
  label: string;
  dsr: number | null;
  delivered: number;
  failed: number;
  total: number;
};

type DriverRank = {
  driver: string;
  delivered: number;
  failed: number;
  total: number;
  dsr: number;
};

type Analysis = {
  maxDate: Date;
  trend: DayPoint[];
  globalDsr: number;
  globalDelivered: number;
  globalTotal: number;
  driverRanking: DriverRank[];
};

function analyze(rows: RawRow[]): Analysis | null {
  const withDate = rows.filter((r) => r.fecha);
  if (withDate.length === 0) return null;
  const maxTs = Math.max(...withDate.map((r) => dayStart(r.fecha!)));

  // Últimos 14 días naturales terminando en la fecha más reciente,
  // mostrando solo días hábiles (L-V).
  const days: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const ts = maxTs - i * 86400000;
    if (isWeekday(ts)) days.push(ts);
  }
  if (days.length === 0) return null;
  const dayStartSet = new Set(days);

  const byDay = new Map<number, { delivered: number; failed: number }>();
  for (const ts of days) byDay.set(ts, { delivered: 0, failed: 0 });
  const byDriver = new Map<string, { delivered: number; failed: number }>();

  for (const r of withDate) {
    const delivered = isDeliveredEstado(r.estado);
    const failed = !delivered && isFailedEstado(r.estado);
    if (!delivered && !failed) continue;

    const ts = dayStart(r.fecha!);
    if (!dayStartSet.has(ts)) continue;

    const d = byDay.get(ts)!;
    if (delivered) d.delivered++;
    else d.failed++;

    const driverKey = r.driver || "— Sin asignar —";
    const dr = byDriver.get(driverKey) ?? { delivered: 0, failed: 0 };
    if (delivered) dr.delivered++;
    else dr.failed++;
    byDriver.set(driverKey, dr);
  }

  const trend: DayPoint[] = days.map((ts) => {
    const d = byDay.get(ts)!;
    const total = d.delivered + d.failed;
    return {
      ts,
      label: new Date(ts).toISOString().slice(5, 10),
      dsr: total > 0 ? (d.delivered / total) * 100 : null,
      delivered: d.delivered,
      failed: d.failed,
      total,
    };
  });

  const globalDelivered = trend.reduce((s, t) => s + t.delivered, 0);
  const globalFailed = trend.reduce((s, t) => s + t.failed, 0);
  const globalTotal = globalDelivered + globalFailed;
  const globalDsr = globalTotal > 0 ? (globalDelivered / globalTotal) * 100 : 0;

  const driverRanking: DriverRank[] = Array.from(byDriver.entries())
    .map(([driver, v]) => {
      const total = v.delivered + v.failed;
      return { driver, delivered: v.delivered, failed: v.failed, total, dsr: total > 0 ? (v.delivered / total) * 100 : 0 };
    })
    .filter((d) => d.total > 0)
    .sort((a, b) => a.dsr - b.dsr)
    .slice(0, 8);

  return {
    maxDate: new Date(maxTs),
    trend,
    globalDsr,
    globalDelivered,
    globalTotal,
    driverRanking,
  };
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

function DriverBar({ rank }: { rank: DriverRank }) {
  const color = dsrColor(rank.dsr);
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 text-xs text-foreground truncate" title={rank.driver}>
        {rank.driver}
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

const chartConfig = {
  dsr: { label: "DSR", color: "var(--electric)" },
} satisfies ChartConfig;

export function DashboardDsrWidgets() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => (rows ? analyze(rows) : null), [rows]);

  const handleFile = async (f: File | null) => {
    setFile(f);
    setRows(null);
    setError(null);
    if (!f) return;
    setLoading(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("El archivo no tiene hojas.");
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
      if (json.length === 0) throw new Error("El archivo está vacío.");
      const headers = Object.keys(json[0]);
      const resolved = resolveColumns(headers);
      if (resolved.missing) {
        throw new Error(
          `Faltan columnas: ${resolved.missing.join(", ")}. Verifica el formato del archivo (se aceptan EPOD en español o en inglés).`,
        );
      }
      const cols = resolved.cols;
      const optCols = resolved.optCols;
      const parsed: RawRow[] = json.map((r) => {
        const estado = String(r[cols.estado] ?? "").trim();
        const fecha = resolveEventDate({
          estado,
          fechaTarea: parseFecha(r[cols.fecha]),
          tiempoEntrega: optCols.tiempoEntrega ? parseFecha(r[optCols.tiempoEntrega]) : null,
          tiempoFracaso: optCols.tiempoFracaso ? parseFecha(r[optCols.tiempoFracaso]) : null,
        });
        return {
          waybill: String(r[cols.waybill] ?? "").trim(),
          fecha,
          estado,
          driver: String(r[cols.driver] ?? "").trim(),
        };
      });
      setRows(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error leyendo el archivo.");
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const dropzone = (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void handleFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      className={`p-5 bg-card border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
        dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="size-6 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">{file.name}</div>
            <div className="text-xs text-muted-foreground">
              {(file.size / 1024 / 1024).toFixed(2)} MB{rows ? ` · ${rows.length} filas` : ""}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void handleFile(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label="Quitar archivo"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Upload className="size-6 text-primary" />
          <div>
            <div className="text-sm font-semibold text-foreground">Sube un ePOD para ver DSR y ranking de drivers</div>
            <div className="text-xs">Sube un ePOD con al menos 14 días de historial para ver la tendencia · .xlsx, .xls</div>
          </div>
        </div>
      )}
    </div>
  );

  const errorBanner = error && (
    <p className="mt-2 text-destructive text-xs flex items-start gap-1.5">
      <AlertCircle className="size-3 mt-0.5 shrink-0" />
      <span>{error}</span>
    </p>
  );

  if (!analysis) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="shadow-none lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" /> DSR y ranking de drivers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dropzone}
            {loading && <p className="mt-2 text-xs text-muted-foreground">Procesando…</p>}
            {errorBanner}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="shadow-none lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" /> Tendencia de DSR (14 días, L-V)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dropzone}
          {loading && <p className="mt-2 text-xs text-muted-foreground">Procesando…</p>}
          {errorBanner}
          <ChartContainer className="mt-4 h-[220px] w-full" config={chartConfig}>
            <LineChart data={analysis.trend} margin={{ left: 8, right: 8 }}>
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
            <span className="text-2xl font-semibold tabular-nums" style={{ color: dsrColor(analysis.globalDsr) }}>
              {analysis.globalDsr.toFixed(1)}%
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-primary" /> Drivers problemáticos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {analysis.driverRanking.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin entregas/fallos en el periodo.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {analysis.driverRanking.map((r) => (
                <DriverBar key={r.driver} rank={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
