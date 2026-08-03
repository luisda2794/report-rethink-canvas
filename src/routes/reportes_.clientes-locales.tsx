import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FileSpreadsheet,
  X,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Settings,
  Download,
  History,
  Info,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { HubCombobox } from "@/components/HubCombobox";
import { getAllHubs, getEpodData, requireFields, type EpodField } from "@/lib/epodStore";
import { isDeliveredEstado, isFailedEstado } from "@/lib/resolve-event-date";
import { getClientesLocalesConfig, applyClientAlias, isClienteLocal, type CpLocalidad } from "@/lib/clientes-locales-config";
import { exportStyledExcel } from "@/lib/xlsx-export";
import {
  getHistorico,
  saveHistorico,
  getDiaSnapshot,
  saveDiaSnapshot,
  getCd4Log,
  saveCd4LogForDate,
  countConsecutivePriorDays,
  type HistoricoEntry,
  type HistoricoStore,
  type DiaSnapshot,
  type DiaSnapshotEntry,
  type Cd4LogEntry,
  type EstadoActual,
} from "@/lib/clientes-locales-snapshots";

export const Route = createFileRoute("/reportes_/clientes-locales")({
  component: () => (
    <RequireAuth path="/reportes">
      <ClientesLocalesPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Clientes Locales" },
      {
        name: "description",
        content:
          "Clientes locales en reparto, flow meeting por CP, CD4 y % Close Loop de SHEIN/resto de clientes locales, a partir de dos EPOD (histórico + del día).",
      },
    ],
  }),
});

// ---------------------------------------------------------------------------
// Resolución de columnas (español / inglés)
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: EpodField[] = ["waybill", "fecha", "estado", "cp", "direccion", "driver", "mercado", "vendedor"];

// El histórico necesita waybill/fecha/cp/driver/estado/mercado/vendedor: T0,
// Cliente Local, y ahora también fecha de entrega (para los reportes % Close Loop).
const HISTORICO_ALIASES = {
  waybill: ["Número de Waybill", "Waybill Number"],
  fecha: ["Fecha de la tarea", "Task Date"],
  cp: ["Código postal", "Zip Code"],
  driver: ["Nombre del Repartidor", "Courier Name"],
  estado: ["Estado de la Tarea", "Task Status"],
  mercado: ["Nombre del mercado", "Market Place Name"],
  vendedor: ["Nombre del vendedor", "Seller Name"],
} as const;
type HistoricoField = keyof typeof HISTORICO_ALIASES;

function resolveHistoricoColumns(
  headers: string[],
): { cols: Record<HistoricoField, string>; missing?: never } | { cols?: never; missing: string[] } {
  const cols = {} as Record<HistoricoField, string>;
  const missing: string[] = [];
  for (const field of Object.keys(HISTORICO_ALIASES) as HistoricoField[]) {
    const aliases = HISTORICO_ALIASES[field];
    const found = aliases.find((a) => headers.includes(a));
    if (found) cols[field] = found;
    else missing.push(aliases.join(" / "));
  }
  return missing.length > 0 ? { missing } : { cols };
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

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const isToday = d.toDateString() === new Date().toDateString();
  return isToday ? `hoy ${time}` : `${d.toLocaleDateString("es-ES")} ${time}`;
}

// ---------------------------------------------------------------------------
// Clasificación de estado (mismas variantes español/inglés que el resto de la app)
// ---------------------------------------------------------------------------

function normalizeEstado(s: string): string {
  return s.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
function isEnRepartoEstado(s: string): boolean {
  const n = normalizeEstado(s);
  return n === "driver received" || n === "driver received incidencias" || n === "driver received incidence" || n === "driver received incidencia";
}
function isCancelarEstado(s: string): boolean {
  const n = normalizeEstado(s);
  return n === "cancelar" || n === "cancel" || n === "cancelled" || n === "canceled";
}
function classifyEstadoActual(estado: string): EstadoActual {
  if (isDeliveredEstado(estado)) return "ENTREGADO";
  if (isEnRepartoEstado(estado)) return "EN_REPARTO";
  if (isFailedEstado(estado)) return "FALLO";
  if (isCancelarEstado(estado)) return "CANCELADO";
  return "OTRO";
}
const ESTADO_LABEL: Record<EstadoActual, string> = {
  ENTREGADO: "Entregado",
  EN_REPARTO: "En Reparto",
  FALLO: "Fallado",
  CANCELADO: "Cancelado",
  OTRO: "—",
};
function computeBadgeLabel(prevEstado: EstadoActual | undefined, currEstado: EstadoActual): string {
  if (currEstado === "EN_REPARTO") return prevEstado === "EN_REPARTO" ? "Sigue en reparto" : "Nuevo en reparto";
  if (currEstado === "ENTREGADO") return prevEstado === "EN_REPARTO" ? "Recién entregado" : "Entregado";
  if (currEstado === "FALLO") return prevEstado === "EN_REPARTO" ? "Recién fallado" : "Fallado";
  if (currEstado === "CANCELADO") return "Cancelado";
  return "—";
}

// ---------------------------------------------------------------------------
// Localidad
// ---------------------------------------------------------------------------

function localidadForCp(cp: string, mapping: CpLocalidad[]): string {
  const found = mapping.find((m) => m.cp.trim() !== "" && m.cp.trim() === cp.trim());
  return found?.localidad || "—";
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type RawRow = {
  waybill: string;
  fecha: Date | null;
  estado: string;
  cp: string;
  direccion: string;
  driver: string;
  mercado: string;
  vendedor: string;
  cliente: string;
  clienteLocal: boolean;
  rowIndex: number;
};

type Report1Row = {
  waybill: string;
  direccion: string;
  cliente: string;
  cp: string;
  localidad: string;
  driver: string;
  estado: EstadoActual;
  badgeLabel: string;
};

type CpGroup = {
  cp: string;
  localidad: string;
  rows: Report1Row[];
};

type ChangesSummary = {
  pasaronAEntregado: number;
  pasaronAFallado: number;
  siguenEnRepartoSinCambios: number;
};

type FlowRow = {
  cp: string;
  localidad: string;
  total: number;
  entregados: number;
  enReparto: number;
  cancelados: number;
  fallos: number;
  pctEntrega: number;
};

type Cd4Row = {
  waybill: string;
  cp: string;
  localidad: string;
  dias: number;
  cliente: string;
  driver: string;
  consecutiveDays: number;
};

// ---------------------------------------------------------------------------
// % Close Loop (SHEIN CD4 / Resto de Clientes Locales CD5)
//
// Numerador = paquetes entregados dentro de `windowDays` desde su inbound (T0).
// Denominador = paquetes cuyo T0 fue hace `windowDays` días o más (ventana ya
// cerrada — un paquete con T0 de ayer/antier todavía no cuenta).
// Fuente: el EPOD Histórico es la única fuente con el rastro de CUÁNDO se
// entregó cada waybill a lo largo de varios días; el EPOD del Día solo
// complementa cp/driver y una entrega ocurrida hoy que el histórico aún no
// capturó (o sirve de único origen, con alcance más limitado, si no hay
// histórico cargado).
// ---------------------------------------------------------------------------

type CloseLoopEntry = {
  waybill: string;
  cliente: string; // ya con el alias aplicado (p.ej. "SHEIN")
  cp: string;
  driver: string;
  t0Ts: number;
  fechaEntregaTs: number | null;
};

type CloseLoopBreakdownRow = { key: string; total: number; enTiempo: number; pct: number };

type CloseLoopReport = {
  total: number;
  enTiempo: number;
  pct: number;
  porCp: CloseLoopBreakdownRow[];
  porDriver: CloseLoopBreakdownRow[];
};

function buildCloseLoop(entries: CloseLoopEntry[], windowDays: number, nowTs: number): CloseLoopReport {
  const isOnTime = (e: CloseLoopEntry) =>
    e.fechaEntregaTs != null && Math.floor((e.fechaEntregaTs - e.t0Ts) / 86400000) <= windowDays;
  const evaluable = entries.filter((e) => Math.floor((nowTs - e.t0Ts) / 86400000) >= windowDays);
  const total = evaluable.length;
  const enTiempo = evaluable.filter(isOnTime).length;
  const pct = total > 0 ? (enTiempo / total) * 100 : 0;

  const buildBreakdown = (keyFn: (e: CloseLoopEntry) => string): CloseLoopBreakdownRow[] => {
    const map = new Map<string, { total: number; enTiempo: number }>();
    for (const e of evaluable) {
      const key = keyFn(e) || "—";
      const b = map.get(key) ?? { total: 0, enTiempo: 0 };
      b.total++;
      if (isOnTime(e)) b.enTiempo++;
      map.set(key, b);
    }
    return Array.from(map.entries())
      .map(([key, b]) => ({ key, total: b.total, enTiempo: b.enTiempo, pct: b.total > 0 ? (b.enTiempo / b.total) * 100 : 0 }))
      .sort((a, b) => b.total - a.total);
  };

  return {
    total,
    enTiempo,
    pct,
    porCp: buildBreakdown((e) => e.cp),
    porDriver: buildBreakdown((e) => e.driver || "— Sin asignar —"),
  };
}

function closeLoopColor(pct: number): string {
  if (pct >= 99.5) return "var(--success)";
  if (pct >= 95) return "var(--warn)";
  return "var(--danger)";
}

type Analysis = {
  epodDate: Date;
  epodDateStr: string;
  report1Groups: CpGroup[];
  report1Total: number;
  changesSummary: ChangesSummary;
  volumeByCp: { name: string; total: number }[];
  volumeByCliente: { name: string; total: number }[];
  flow: FlowRow[];
  cd4: Cd4Row[];
  cd4UsedFallbackT0: boolean;
  snapshotToSave: DiaSnapshot;
  cd4LogEntries: Cd4LogEntry[];
  sheinCloseLoop: CloseLoopReport;
  localCloseLoop: CloseLoopReport;
};

function analyze(rows: RawRow[], cpMapping: CpLocalidad[], historico: HistoricoStore | null): Analysis | null {
  const localRows = rows.filter((r) => r.clienteLocal && r.fecha && r.waybill);
  if (localRows.length === 0) return null;
  const maxTs = Math.max(...localRows.map((r) => dayStart(r.fecha!)));
  const epodDate = new Date(maxTs);
  const epodDateStr = formatDate(epodDate);

  const todayLocalRows = localRows.filter((r) => dayStart(r.fecha!) === maxTs);

  // Dedup por waybill: último registro cronológico de hoy = "estado actual".
  const byWaybillToday = new Map<string, RawRow[]>();
  for (const r of todayLocalRows) {
    const arr = byWaybillToday.get(r.waybill) ?? [];
    arr.push(r);
    byWaybillToday.set(r.waybill, arr);
  }
  const currentByWaybill = new Map<string, RawRow>();
  for (const [waybill, rs] of byWaybillToday) {
    const sorted = [...rs].sort((a, b) => {
      const at = a.fecha!.getTime();
      const bt = b.fecha!.getTime();
      if (at === bt) return a.rowIndex - b.rowIndex;
      return at - bt;
    });
    currentByWaybill.set(waybill, sorted[sorted.length - 1]);
  }

  // Snapshot anterior de HOY (antes de reemplazarlo).
  const prevSnapshot = getDiaSnapshot(epodDateStr);
  const prevByWaybill = new Map<string, EstadoActual>();
  if (prevSnapshot) for (const e of prevSnapshot.entries) prevByWaybill.set(e.waybill, e.estado);

  // ---- Reporte 1: todos los Cliente Local de hoy, con badge de cambio ----
  const report1RowsFlat: Report1Row[] = [];
  const snapshotEntries: DiaSnapshotEntry[] = [];
  for (const [waybill, r] of currentByWaybill) {
    const estadoActual = classifyEstadoActual(r.estado);
    const badgeLabel = computeBadgeLabel(prevByWaybill.get(waybill), estadoActual);
    const localidad = localidadForCp(r.cp, cpMapping);
    report1RowsFlat.push({
      waybill,
      direccion: r.direccion,
      cliente: r.cliente,
      cp: r.cp,
      localidad,
      driver: r.driver,
      estado: estadoActual,
      badgeLabel,
    });
    snapshotEntries.push({ waybill, estado: estadoActual, cp: r.cp, cliente: r.cliente, driver: r.driver, direccion: r.direccion });
  }

  const changesSummary: ChangesSummary = {
    pasaronAEntregado: report1RowsFlat.filter((r) => r.badgeLabel === "Recién entregado").length,
    pasaronAFallado: report1RowsFlat.filter((r) => r.badgeLabel === "Recién fallado").length,
    siguenEnRepartoSinCambios: report1RowsFlat.filter((r) => r.badgeLabel === "Sigue en reparto").length,
  };

  const cpGroupMap = new Map<string, CpGroup>();
  for (const r of report1RowsFlat) {
    const key = r.cp || "—";
    const g = cpGroupMap.get(key) ?? { cp: key, localidad: r.localidad, rows: [] };
    g.rows.push(r);
    cpGroupMap.set(key, g);
  }
  const report1Groups = Array.from(cpGroupMap.values())
    .map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => a.driver.localeCompare(b.driver)) }))
    .sort((a, b) => b.rows.length - a.rows.length);

  const volumeByCp = report1Groups.map((g) => ({ name: g.cp, total: g.rows.length }));

  const clienteMap = new Map<string, number>();
  for (const r of report1RowsFlat) {
    const key = r.cliente || "— Sin cliente —";
    clienteMap.set(key, (clienteMap.get(key) ?? 0) + 1);
  }
  const volumeByCliente = Array.from(clienteMap.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  // ---- Reporte 2: Flow Meeting por CP (sobre el estado actual, deduplicado) ----
  const flowMap = new Map<string, { entregados: number; enReparto: number; cancelados: number; fallos: number; total: number }>();
  for (const r of report1RowsFlat) {
    const key = r.cp || "—";
    const b = flowMap.get(key) ?? { entregados: 0, enReparto: 0, cancelados: 0, fallos: 0, total: 0 };
    b.total++;
    if (r.estado === "ENTREGADO") b.entregados++;
    else if (r.estado === "EN_REPARTO") b.enReparto++;
    else if (r.estado === "CANCELADO") b.cancelados++;
    else if (r.estado === "FALLO") b.fallos++;
    flowMap.set(key, b);
  }
  const flow: FlowRow[] = Array.from(flowMap.entries())
    .map(([cp, b]) => ({ cp, localidad: localidadForCp(cp, cpMapping), ...b, pctEntrega: b.total > 0 ? (b.entregados / b.total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);

  // ---- Reporte 3: CD4 (T0 del histórico, o respaldo dentro del mismo archivo) ----
  const historicoMap = new Map<string, HistoricoEntry>();
  if (historico) for (const e of historico.entries) historicoMap.set(e.waybill, e);

  const cd4Log = getCd4Log();
  let cd4UsedFallbackT0 = false;
  const cd4: Cd4Row[] = [];
  const cd4LogEntries: Cd4LogEntry[] = [];
  for (const r of report1RowsFlat) {
    if (r.estado !== "EN_REPARTO") continue;
    let t0Ts: number;
    const hist = historicoMap.get(r.waybill);
    if (hist) {
      t0Ts = dayStart(new Date(hist.t0));
    } else {
      const datesForWaybill = localRows.filter((x) => x.waybill === r.waybill).map((x) => dayStart(x.fecha!));
      t0Ts = Math.min(...datesForWaybill);
      cd4UsedFallbackT0 = true;
    }
    const dias = Math.floor((maxTs - t0Ts) / 86400000);
    if (dias < 4) continue;
    const consecutiveDays = countConsecutivePriorDays(r.waybill, epodDateStr, cd4Log) + 1;
    cd4.push({ waybill: r.waybill, cp: r.cp, localidad: r.localidad, dias, cliente: r.cliente, driver: r.driver, consecutiveDays });
    cd4LogEntries.push({ waybill: r.waybill, dias, cliente: r.cliente, cp: r.cp });
  }
  cd4.sort((a, b) => b.dias - a.dias);

  // ---- Reportes 4/5: % Close Loop (SHEIN CD4 y Resto de Clientes Locales CD5) ----
  const closeLoopMap = new Map<string, CloseLoopEntry>();
  if (historico) {
    for (const h of historico.entries) {
      if (!h.clienteLocal) continue;
      closeLoopMap.set(h.waybill, {
        waybill: h.waybill,
        cliente: h.cliente,
        cp: h.cp,
        driver: h.driver,
        t0Ts: dayStart(new Date(h.t0)),
        fechaEntregaTs: h.fechaEntrega ? dayStart(new Date(h.fechaEntrega)) : null,
      });
    }
  }
  for (const r of report1RowsFlat) {
    const todayEntregaTs = r.estado === "ENTREGADO" ? maxTs : null;
    const existing = closeLoopMap.get(r.waybill);
    if (existing) {
      existing.cp = r.cp;
      existing.driver = r.driver;
      if (existing.fechaEntregaTs == null && todayEntregaTs != null) existing.fechaEntregaTs = todayEntregaTs;
    } else {
      const datesForWaybill = localRows.filter((x) => x.waybill === r.waybill).map((x) => dayStart(x.fecha!));
      const t0Ts = datesForWaybill.length > 0 ? Math.min(...datesForWaybill) : maxTs;
      closeLoopMap.set(r.waybill, {
        waybill: r.waybill,
        cliente: r.cliente,
        cp: r.cp,
        driver: r.driver,
        t0Ts,
        fechaEntregaTs: todayEntregaTs,
      });
    }
  }
  const allCloseLoopEntries = Array.from(closeLoopMap.values());
  const sheinCloseLoop = buildCloseLoop(allCloseLoopEntries.filter((e) => e.cliente === "SHEIN"), 4, maxTs);
  const localCloseLoop = buildCloseLoop(allCloseLoopEntries.filter((e) => e.cliente !== "SHEIN"), 5, maxTs);

  return {
    epodDate,
    epodDateStr,
    report1Groups,
    report1Total: report1RowsFlat.length,
    changesSummary,
    volumeByCp,
    volumeByCliente,
    flow,
    cd4,
    cd4UsedFallbackT0,
    snapshotToSave: { fecha: epodDateStr, updatedAt: new Date().toISOString(), entries: snapshotEntries },
    cd4LogEntries,
    sheinCloseLoop,
    localCloseLoop,
  };
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function pctEntregaColor(pct: number): string {
  if (pct > 80) return "var(--success)";
  if (pct < 50) return "var(--danger)";
  return "var(--warn)";
}

const volumeChartConfig = {
  total: { label: "Paquetes", color: "var(--electric)" },
} satisfies ChartConfig;

function VolumeBarChart({ data }: { data: { name: string; total: number }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos.</p>;
  }
  return (
    <ChartContainer className="h-[220px] w-full" config={volumeChartConfig}>
      <BarChart data={data} margin={{ left: 8, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={10} interval={0} angle={-30} textAnchor="end" height={50} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={28} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

function Th({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <th className={`px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground ${right ? "text-right" : "text-left"} ${className}`}>
      {children}
    </th>
  );
}
function Td({ children, right, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <td className={`px-3 py-1.5 ${right ? "text-right" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}

function StatBox({ label, value, tone }: { label: string; value: number; tone: "success" | "danger" | "muted" }) {
  const color = tone === "success" ? "var(--success)" : tone === "danger" ? "var(--danger)" : undefined;
  return (
    <div className="p-4 rounded-lg border bg-card">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

function Dropzone({
  label,
  hint,
  file,
  dragOver,
  loading,
  error,
  onFile,
  onDragOver,
  onDragLeave,
}: {
  label: string;
  hint: string;
  file: File | null;
  dragOver: boolean;
  loading: boolean;
  error: string | null;
  onFile: (f: File | null) => void;
  onDragOver: (v: boolean) => void;
  onDragLeave: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); onDragOver(true); }}
        onDragLeave={onDragLeave}
        onDrop={(e) => {
          e.preventDefault();
          onDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
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
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="size-6 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">{file.name}</div>
              <div className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFile(null);
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
              <div className="text-sm font-semibold text-foreground">{label}</div>
              <div className="text-xs">{hint}</div>
            </div>
          </div>
        )}
      </div>
      {loading && <p className="mt-2 text-xs text-muted-foreground">Procesando…</p>}
      {error && (
        <p className="mt-2 text-destructive text-xs flex items-start gap-1.5">
          <AlertCircle className="size-3 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

function CloseLoopSection({
  windowDays,
  report,
  hasHistorico,
  onExport,
}: {
  windowDays: number;
  report: CloseLoopReport;
  hasHistorico: boolean;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {!hasHistorico && (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5 p-3 rounded-md border bg-muted">
          <Info className="size-3.5 mt-0.5 shrink-0" />
          <span>
            Sube un EPOD Histórico para un cálculo completo. Sin él, este % solo considera los waybills vistos en el
            EPOD del día de hoy.
          </span>
        </p>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Ventana de {windowDays} días desde inbound · target 99.5%
        </p>
        <Button onClick={onExport} disabled={report.total === 0} size="sm" className="gap-2">
          <Download className="size-3.5" /> Exportar a Excel
        </Button>
      </div>

      <div className="p-4 rounded-lg border bg-card max-w-xs">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">% Close Loop General</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums" style={{ color: closeLoopColor(report.pct) }}>
          {report.total > 0 ? `${report.pct.toFixed(1)}%` : "—"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {report.enTiempo} de {report.total} paquetes con ventana cerrada
        </div>
      </div>

      {report.total === 0 ? (
        <Card className="shadow-none">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Todavía no hay paquetes con ventana cerrada (T0 hace {windowDays}+ días).
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Por CP</h4>
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-muted">
                  <tr>
                    <Th>CP</Th>
                    <Th right>Total</Th>
                    <Th right>En Tiempo</Th>
                    <Th right>%</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.porCp.map((r) => (
                    <tr key={r.key} className="border-t border-border">
                      <Td className="whitespace-nowrap">{r.key}</Td>
                      <Td right className="tabular-nums">{r.total}</Td>
                      <Td right className="tabular-nums">{r.enTiempo}</Td>
                      <Td right className="tabular-nums font-semibold">
                        <span style={{ color: closeLoopColor(r.pct) }}>{r.pct.toFixed(1)}%</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-2">Por Driver</h4>
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-muted">
                  <tr>
                    <Th>Driver</Th>
                    <Th right>Total</Th>
                    <Th right>En Tiempo</Th>
                    <Th right>%</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.porDriver.map((r) => (
                    <tr key={r.key} className="border-t border-border">
                      <Td className="whitespace-nowrap">{r.key}</Td>
                      <Td right className="tabular-nums">{r.total}</Td>
                      <Td right className="tabular-nums">{r.enTiempo}</Td>
                      <Td right className="tabular-nums font-semibold">
                        <span style={{ color: closeLoopColor(r.pct) }}>{r.pct.toFixed(1)}%</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function ClientesLocalesPage() {
  const [historicoFile, setHistoricoFile] = useState<File | null>(null);
  const [historicoDragOver, setHistoricoDragOver] = useState(false);
  const [historicoLoading, setHistoricoLoading] = useState(false);
  const [historicoError, setHistoricoError] = useState<string | null>(null);
  const [historicoInfo, setHistoricoInfo] = useState<{ count: number; updatedAt: string } | null>(() => {
    const h = getHistorico();
    return h ? { count: h.entries.length, updatedAt: h.updatedAt } : null;
  });

  const [hub, setHub] = useState("");
  const [diaLoading, setDiaLoading] = useState(false);
  const [diaError, setDiaError] = useState<string | null>(null);
  const [hasAnyHub, setHasAnyHub] = useState<boolean | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<string | null>(() => {
    const snap = getDiaSnapshot(formatDate(new Date()));
    return snap?.updatedAt ?? null;
  });

  useEffect(() => {
    getAllHubs()
      .then((list) => setHasAnyHub(list.length > 0))
      .catch(() => setHasAnyHub(false));
  }, []);

  useEffect(() => {
    if (!hub.trim()) {
      setAnalysis(null);
      setDiaError(null);
      return;
    }
    let cancelled = false;
    setDiaLoading(true);
    setDiaError(null);
    getEpodData(hub.trim())
      .then((record) => {
        if (cancelled) return;
        if (!record) {
          setAnalysis(null);
          setDiaError(`No hay datos cargados para "${hub.trim()}".`);
          return;
        }
        requireFields(record.metadata.detectedFields, REQUIRED_FIELDS);
        const config = getClientesLocalesConfig();
        const parsed: RawRow[] = record.rows.map((r) => {
          const mercado = r.mercado;
          const vendedor = r.vendedor;
          return {
            waybill: r.waybill,
            fecha: r.fecha ? new Date(r.fecha) : null,
            estado: r.estado,
            cp: r.cp,
            direccion: r.direccion,
            driver: r.driver,
            mercado,
            vendedor,
            cliente: applyClientAlias(mercado || vendedor, config),
            clienteLocal: isClienteLocal(mercado, vendedor, config),
            rowIndex: r.rowIndex,
          };
        });
        const historico = getHistorico();
        const result = analyze(parsed, config.cpMapping, historico);
        if (!result) {
          setAnalysis(null);
          setDiaError("No se encontraron clientes locales con fecha válida en este hub.");
          return;
        }
        saveDiaSnapshot(result.snapshotToSave);
        saveCd4LogForDate(result.epodDateStr, result.cd4LogEntries);
        setAnalysis(result);
        setLastUpdateAt(result.snapshotToSave.updatedAt);
      })
      .catch((e) => {
        if (cancelled) return;
        setAnalysis(null);
        setDiaError(e instanceof Error ? e.message : "Error cargando los datos del hub.");
      })
      .finally(() => {
        if (!cancelled) setDiaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hub]);

  const handleHistorico = async (f: File | null) => {
    setHistoricoFile(f);
    setHistoricoError(null);
    if (!f) return;
    setHistoricoLoading(true);
    try {
      const config = getClientesLocalesConfig();
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("El archivo no tiene hojas.");
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
      if (json.length === 0) throw new Error("El archivo está vacío.");
      const headers = Object.keys(json[0]);
      const resolved = resolveHistoricoColumns(headers);
      if (resolved.missing) {
        throw new Error(
          `Faltan columnas: ${resolved.missing.join(", ")}. Verifica el formato del archivo (se aceptan EPOD en español o en inglés).`,
        );
      }
      const cols = resolved.cols;
      type HistRow = {
        waybill: string;
        fecha: Date | null;
        cp: string;
        driver: string;
        estado: string;
        cliente: string;
        clienteLocal: boolean;
      };
      const parsed: HistRow[] = json.map((r) => {
        const mercado = String(r[cols.mercado] ?? "").trim();
        const vendedor = String(r[cols.vendedor] ?? "").trim();
        return {
          waybill: String(r[cols.waybill] ?? "").trim(),
          fecha: parseFecha(r[cols.fecha]),
          cp: String(r[cols.cp] ?? "").trim(),
          driver: String(r[cols.driver] ?? "").trim(),
          estado: String(r[cols.estado] ?? "").trim(),
          cliente: applyClientAlias(mercado || vendedor, config),
          clienteLocal: isClienteLocal(mercado, vendedor, config),
        };
      });
      const localRows = parsed.filter((r) => r.clienteLocal && r.fecha && r.waybill);
      if (localRows.length === 0) throw new Error("No se encontraron clientes locales con fecha válida en este archivo.");
      const byWaybill = new Map<string, HistRow[]>();
      for (const r of localRows) {
        const arr = byWaybill.get(r.waybill) ?? [];
        arr.push(r);
        byWaybill.set(r.waybill, arr);
      }
      const entries: HistoricoEntry[] = [];
      for (const [waybill, rs] of byWaybill) {
        const sorted = [...rs].sort((a, b) => a.fecha!.getTime() - b.fecha!.getTime());
        const t0 = sorted[0].fecha!;
        const last = sorted[sorted.length - 1];
        const firstDelivered = sorted.find((r) => isDeliveredEstado(r.estado));
        entries.push({
          waybill,
          t0: t0.toISOString(),
          cp: last.cp,
          cliente: last.cliente,
          driver: last.driver,
          clienteLocal: true,
          fechaEntrega: firstDelivered ? firstDelivered.fecha!.toISOString() : null,
        });
      }
      saveHistorico(entries);
      setHistoricoInfo({ count: entries.length, updatedAt: new Date().toISOString() });
    } catch (e) {
      setHistoricoError(e instanceof Error ? e.message : "Error leyendo el archivo.");
      setHistoricoFile(null);
    } finally {
      setHistoricoLoading(false);
    }
  };

  const exportReport1 = () => {
    if (!analysis) return;
    const rowsOut = analysis.report1Groups.flatMap((g) =>
      g.rows.map((r) => [r.waybill, r.direccion, r.cliente, r.cp, r.localidad, r.driver, ESTADO_LABEL[r.estado], r.badgeLabel]),
    );
    if (rowsOut.length === 0) return;
    exportStyledExcel({
      title: "Clientes Locales en Reparto",
      date: analysis.epodDateStr,
      headers: ["Waybill", "Dirección", "Cliente", "CP", "Localidad", "Driver", "Estado Actual", "Cambio"],
      rows: rowsOut,
      filename: `clientes_locales_en_reparto_${analysis.epodDateStr}.xlsx`,
      colWidths: [22, 40, 24, 10, 20, 22, 14, 20],
    });
  };

  const exportFlow = () => {
    if (!analysis || analysis.flow.length === 0) return;
    exportStyledExcel({
      title: "Clientes Locales — Flow Meeting",
      date: analysis.epodDateStr,
      headers: ["CP", "Localidad", "Total", "Entregados", "En Reparto", "Cancelados", "Fallos", "% Entrega"],
      rows: analysis.flow.map((f) => [f.cp, f.localidad, f.total, f.entregados, f.enReparto, f.cancelados, f.fallos, Number(f.pctEntrega.toFixed(1))]),
      filename: `clientes_locales_flow_meeting_${analysis.epodDateStr}.xlsx`,
      colWidths: [10, 20, 8, 12, 12, 12, 10, 12],
    });
  };

  const exportCd4 = () => {
    if (!analysis || analysis.cd4.length === 0) return;
    exportStyledExcel({
      title: "Clientes Locales — CD4",
      date: analysis.epodDateStr,
      headers: ["Waybill", "CP", "Localidad", "Días desde Inbound", "Cliente", "Driver", "Días Consecutivos CD4"],
      rows: analysis.cd4.map((r) => [r.waybill, r.cp, r.localidad, r.dias, r.cliente, r.driver, r.consecutiveDays]),
      filename: `clientes_locales_cd4_${analysis.epodDateStr}.xlsx`,
      colWidths: [22, 10, 20, 18, 24, 22, 20],
      rowFill: (row) => {
        const consecutive = Number(row[6]);
        const dias = Number(row[3]);
        if (consecutive >= 3) return "F5A623";
        if (dias >= 6) return "FADBD8";
        return undefined;
      },
    });
  };

  const closeLoopRowFill = (row: (string | number)[]) => {
    const pct = Number(row[4]);
    if (pct >= 99.5) return undefined;
    if (pct >= 95) return "FEF3C7";
    return "FADBD8";
  };

  const exportSheinCloseLoop = () => {
    if (!analysis || analysis.sheinCloseLoop.total === 0) return;
    const r = analysis.sheinCloseLoop;
    const rows: (string | number)[][] = [["General", "-", r.total, r.enTiempo, Number(r.pct.toFixed(1))]];
    for (const c of r.porCp) rows.push(["CP", c.key, c.total, c.enTiempo, Number(c.pct.toFixed(1))]);
    for (const d of r.porDriver) rows.push(["Driver", d.key, d.total, d.enTiempo, Number(d.pct.toFixed(1))]);
    exportStyledExcel({
      title: "SHEIN — % Close Loop (CD4)",
      date: analysis.epodDateStr,
      headers: ["Nivel", "Clave", "Total", "En Tiempo", "% Close Loop"],
      rows,
      filename: `shein_close_loop_cd4_${analysis.epodDateStr}.xlsx`,
      colWidths: [10, 24, 10, 12, 14],
      rowFill: closeLoopRowFill,
    });
  };

  const exportLocalCloseLoop = () => {
    if (!analysis || analysis.localCloseLoop.total === 0) return;
    const r = analysis.localCloseLoop;
    const rows: (string | number)[][] = [["General", "-", r.total, r.enTiempo, Number(r.pct.toFixed(1))]];
    for (const c of r.porCp) rows.push(["CP", c.key, c.total, c.enTiempo, Number(c.pct.toFixed(1))]);
    for (const d of r.porDriver) rows.push(["Driver", d.key, d.total, d.enTiempo, Number(d.pct.toFixed(1))]);
    exportStyledExcel({
      title: "Resto de Clientes Locales — % Close Loop (CD5)",
      date: analysis.epodDateStr,
      headers: ["Nivel", "Clave", "Total", "En Tiempo", "% Close Loop"],
      rows,
      filename: `resto_locales_close_loop_cd5_${analysis.epodDateStr}.xlsx`,
      colWidths: [10, 24, 10, 12, 14],
      rowFill: closeLoopRowFill,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link to="/reportes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Volver a Reportes
        </Link>
        <Link to="/reportes/clientes-locales/admin" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <Settings className="size-3.5" /> Configuración
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Clientes Locales</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Clientes locales en reparto, flow meeting por CP, CD4, y % Close Loop de SHEIN y del resto de clientes locales.
          {analysis && (
            <>
              {" "}Fecha del EPOD del día <strong>{analysis.epodDateStr}</strong>
            </>
          )}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="size-4 text-primary" /> 1. EPOD Histórico (opcional si ya lo subiste antes)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Dropzone
              label="Sube el EPOD histórico (multi-día)"
              hint="Calcula T0 (inbound) y fecha de entrega por waybill — habilita SHEIN CD4% y Resto Locales CD5% · .xlsx"
              file={historicoFile}
              dragOver={historicoDragOver}
              loading={historicoLoading}
              error={historicoError}
              onFile={(f) => void handleHistorico(f)}
              onDragOver={setHistoricoDragOver}
              onDragLeave={() => setHistoricoDragOver(false)}
            />
            {historicoInfo && (
              <p className="mt-2 text-xs text-muted-foreground">
                {historicoInfo.count} waybills cargados · actualizado {formatUpdatedAt(historicoInfo.updatedAt)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-primary" /> 2. EPOD del Día (elige el hub para ver la foto en vivo)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <HubCombobox value={hub} onChange={setHub} className="max-w-xs" />
            {diaLoading && <p className="mt-2 text-xs text-muted-foreground">Cargando datos del hub…</p>}
            {diaError && (
              <p className="mt-2 text-destructive text-xs flex items-start gap-1.5">
                <AlertCircle className="size-3 mt-0.5 shrink-0" />
                <span>{diaError}</span>
              </p>
            )}
            {hasAnyHub === false && (
              <p className="mt-2 text-sm text-muted-foreground flex items-center gap-2">
                No hay datos cargados. Ve a la sección ePOD para subir el archivo de un hub.
                <Link to="/epod" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Ir a ePOD <ArrowRight className="size-3.5" />
                </Link>
              </p>
            )}
            {lastUpdateAt && (
              <p className="mt-2 text-xs text-muted-foreground">Última actualización: {formatUpdatedAt(lastUpdateAt)}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {analysis && (
        <Tabs defaultValue="enreparto">
          <TabsList>
            <TabsTrigger value="enreparto">Clientes Locales en Reparto</TabsTrigger>
            <TabsTrigger value="flow">Flow Meeting</TabsTrigger>
            <TabsTrigger value="cd4">CD4</TabsTrigger>
            <TabsTrigger value="shein-cd4">SHEIN CD4 %</TabsTrigger>
            <TabsTrigger value="local-cd5">Resto Locales CD5 %</TabsTrigger>
          </TabsList>

          {/* REPORTE 1 */}
          <TabsContent value="enreparto" className="flex flex-col gap-4 mt-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">¿Qué cambió desde la última actualización?</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatBox label="Pasaron a Entregado" value={analysis.changesSummary.pasaronAEntregado} tone="success" />
                <StatBox label="Pasaron a Fallado" value={analysis.changesSummary.pasaronAFallado} tone="danger" />
                <StatBox label="Siguen en reparto sin cambios" value={analysis.changesSummary.siguenEnRepartoSinCambios} tone="muted" />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{analysis.report1Total} paquetes de clientes locales hoy</p>
              <Button onClick={exportReport1} disabled={analysis.report1Total === 0} size="sm" className="gap-2">
                <Download className="size-3.5" /> Exportar a Excel
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="shadow-none">
                <CardHeader><CardTitle className="text-sm">Volumen por CP</CardTitle></CardHeader>
                <CardContent><VolumeBarChart data={analysis.volumeByCp} /></CardContent>
              </Card>
              <Card className="shadow-none">
                <CardHeader><CardTitle className="text-sm">Volumen por Cliente</CardTitle></CardHeader>
                <CardContent><VolumeBarChart data={analysis.volumeByCliente} /></CardContent>
              </Card>
            </div>

            {analysis.report1Groups.length === 0 ? (
              <Card className="shadow-none"><CardContent className="pt-6 text-sm text-muted-foreground">Sin clientes locales hoy ✓</CardContent></Card>
            ) : (
              <div className="flex flex-col gap-4">
                {analysis.report1Groups.map((g) => (
                  <div key={g.cp} className="rounded-lg border overflow-hidden">
                    <div className="flex items-center justify-between bg-muted px-3 py-2">
                      <span className="text-sm font-semibold text-foreground">
                        CP {g.cp} {g.localidad !== "—" && <span className="text-muted-foreground font-normal">· {g.localidad}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">Subtotal: {g.rows.length}</span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Waybill</TableHead>
                          <TableHead>Dirección</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Driver</TableHead>
                          <TableHead>Estado Actual</TableHead>
                          <TableHead>Cambio</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.rows.map((r) => (
                          <TableRow key={r.waybill}>
                            <TableCell className="whitespace-nowrap">{r.waybill}</TableCell>
                            <TableCell className="max-w-[260px] truncate" title={r.direccion}>{r.direccion || "—"}</TableCell>
                            <TableCell>{r.cliente || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.driver || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{ESTADO_LABEL[r.estado]}</TableCell>
                            <TableCell className="whitespace-nowrap">
                              <span className="px-1.5 py-0.5 text-[11px] rounded border bg-muted">{r.badgeLabel}</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* REPORTE 2 */}
          <TabsContent value="flow" className="flex flex-col gap-4 mt-4">
            <div className="flex items-center justify-end">
              <Button onClick={exportFlow} disabled={analysis.flow.length === 0} size="sm" className="gap-2">
                <Download className="size-3.5" /> Exportar a Excel
              </Button>
            </div>
            {analysis.flow.length === 0 ? (
              <Card className="shadow-none"><CardContent className="pt-6 text-sm text-muted-foreground">Sin clientes locales en el EPOD ✓</CardContent></Card>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-muted">
                    <tr>
                      <Th>CP</Th>
                      <Th>Localidad</Th>
                      <Th right>Total</Th>
                      <Th right>Entregados</Th>
                      <Th right>En Reparto</Th>
                      <Th right>Cancelados</Th>
                      <Th right>Fallos</Th>
                      <Th right>% Entrega</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.flow.map((f) => (
                      <tr key={f.cp} className="border-t border-border">
                        <Td className="whitespace-nowrap">{f.cp}</Td>
                        <Td>{f.localidad}</Td>
                        <Td right className="tabular-nums font-semibold">{f.total}</Td>
                        <Td right className="tabular-nums">{f.entregados}</Td>
                        <Td right className="tabular-nums">{f.enReparto}</Td>
                        <Td right className="tabular-nums">{f.cancelados}</Td>
                        <Td right className="tabular-nums">{f.fallos}</Td>
                        <Td right className="tabular-nums font-semibold">
                          <span style={{ color: pctEntregaColor(f.pctEntrega) }}>{f.pctEntrega.toFixed(1)}%</span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* REPORTE 3 */}
          <TabsContent value="cd4" className="flex flex-col gap-4 mt-4">
            {!historicoInfo && (
              <p className="text-xs text-muted-foreground flex items-start gap-1.5 p-3 rounded-md border bg-muted">
                <Info className="size-3.5 mt-0.5 shrink-0" />
                <span>Sube un EPOD Histórico para un cálculo de antigüedad más preciso. Por ahora, CD4 usa el T0 calculado dentro del propio EPOD del día.</span>
              </p>
            )}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {analysis.cd4.length} waybills de clientes locales rompiendo CD4 (≥4 días desde inbound)
              </p>
              <Button onClick={exportCd4} disabled={analysis.cd4.length === 0} size="sm" className="gap-2">
                <Download className="size-3.5" /> Exportar a Excel
              </Button>
            </div>
            {analysis.cd4.length === 0 ? (
              <Card className="shadow-none"><CardContent className="pt-6 text-sm text-muted-foreground">Sin paquetes rompiendo CD4 ✓</CardContent></Card>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-muted">
                    <tr>
                      <Th>Waybill</Th>
                      <Th>CP</Th>
                      <Th>Localidad</Th>
                      <Th right>Días desde Inbound</Th>
                      <Th>Cliente</Th>
                      <Th>Driver</Th>
                      <Th right>Días Consecutivos CD4</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.cd4.map((r) => {
                      const consecutiveCritical = r.consecutiveDays >= 3;
                      const diasCritical = r.dias >= 6;
                      const rowClass = consecutiveCritical ? "bg-orange-500/15" : diasCritical ? "bg-destructive/10" : "";
                      return (
                        <tr key={r.waybill} className={`border-t border-border ${rowClass}`}>
                          <Td className="whitespace-nowrap">{r.waybill}</Td>
                          <Td className="whitespace-nowrap">{r.cp}</Td>
                          <Td>{r.localidad}</Td>
                          <Td right className={`tabular-nums font-semibold ${diasCritical ? "text-destructive" : ""}`}>{r.dias}d</Td>
                          <Td>{r.cliente || "—"}</Td>
                          <Td className="whitespace-nowrap">{r.driver || "—"}</Td>
                          <Td right className={`tabular-nums font-semibold ${consecutiveCritical ? "text-orange-600" : ""}`}>{r.consecutiveDays}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* REPORTE 4 */}
          <TabsContent value="shein-cd4" className="flex flex-col gap-4 mt-4">
            <CloseLoopSection
              windowDays={4}
              report={analysis.sheinCloseLoop}
              hasHistorico={!!historicoInfo}
              onExport={exportSheinCloseLoop}
            />
          </TabsContent>

          {/* REPORTE 5 */}
          <TabsContent value="local-cd5" className="flex flex-col gap-4 mt-4">
            <CloseLoopSection
              windowDays={5}
              report={analysis.localCloseLoop}
              hasHistorico={!!historicoInfo}
              onExport={exportLocalCloseLoop}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
