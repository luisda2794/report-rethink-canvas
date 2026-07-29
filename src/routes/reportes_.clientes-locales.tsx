import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FileSpreadsheet,
  X,
  AlertCircle,
  ArrowLeft,
  Settings,
  Download,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { isDeliveredEstado, isFailedEstado } from "@/lib/resolve-event-date";
import { getClientesLocalesConfig, type ClientesLocalesConfig, type CpLocalidad } from "@/lib/clientes-locales-config";
import { exportStyledExcel } from "@/lib/xlsx-export";

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
        content: "Clientes locales en reparto, flow meeting por CP y CD4, a partir de un ePOD.",
      },
    ],
  }),
});

// ---------------------------------------------------------------------------
// Resolución de columnas (español / inglés)
// ---------------------------------------------------------------------------

const REQUIRED_ALIASES = {
  waybill: ["Número de Waybill", "Waybill Number"],
  fecha: ["Fecha de la tarea", "Task Date"],
  estado: ["Estado de la Tarea", "Task Status"],
  cp: ["Código postal", "Zip Code"],
  direccion: ["Dirección detallada", "Detailed address"],
  driver: ["Nombre del Repartidor", "Courier Name"],
  mercado: ["Nombre del mercado", "Market Place Name"],
  vendedor: ["Nombre del vendedor", "Seller Name"],
} as const;
type RequiredField = keyof typeof REQUIRED_ALIASES;

function resolveColumns(
  headers: string[],
): { cols: Record<RequiredField, string>; missing?: never } | { cols?: never; missing: string[] } {
  const cols = {} as Record<RequiredField, string>;
  const missing: string[] = [];
  for (const field of Object.keys(REQUIRED_ALIASES) as RequiredField[]) {
    const aliases = REQUIRED_ALIASES[field];
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

// ---------------------------------------------------------------------------
// Regla de negocio: Cliente Local
// ---------------------------------------------------------------------------

function isClienteLocal(mercado: string, vendedor: string, config: ClientesLocalesConfig): boolean {
  const excludeSet = new Set(config.excludeMarketplace.map((s) => s.trim().toLowerCase()));
  const includeSet = new Set(config.includeSeller.map((s) => s.trim().toLowerCase()));
  const mercadoTrim = mercado.trim();
  const vendedorTrim = vendedor.trim();
  const condA = mercadoTrim !== "" && !excludeSet.has(mercadoTrim.toLowerCase());
  const condB = vendedorTrim !== "" && includeSet.has(vendedorTrim.toLowerCase());
  return condA || condB;
}

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

type EnRepartoRow = {
  waybill: string;
  direccion: string;
  cliente: string;
  cp: string;
  localidad: string;
  driver: string;
};

type CpGroup = {
  cp: string;
  localidad: string;
  rows: EnRepartoRow[];
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
};

type Analysis = {
  epodDate: Date;
  enRepartoGroups: CpGroup[];
  enRepartoTotal: number;
  volumeByCp: { name: string; total: number }[];
  volumeByCliente: { name: string; total: number }[];
  flow: FlowRow[];
  cd4: Cd4Row[];
};

function analyze(rows: RawRow[], cpMapping: CpLocalidad[]): Analysis | null {
  const localRows = rows.filter((r) => r.clienteLocal && r.fecha);
  if (localRows.length === 0) return null;
  const maxTs = Math.max(...localRows.map((r) => dayStart(r.fecha!)));
  const epodDate = new Date(maxTs);

  const todayLocalRows = localRows.filter((r) => dayStart(r.fecha!) === maxTs);

  // ---- Reporte 1: Clientes Locales en Reparto ----
  const enRepartoRows: EnRepartoRow[] = todayLocalRows
    .filter((r) => isEnRepartoEstado(r.estado))
    .map((r) => ({
      waybill: r.waybill,
      direccion: r.direccion,
      cliente: r.cliente,
      cp: r.cp,
      localidad: localidadForCp(r.cp, cpMapping),
      driver: r.driver,
    }));

  const cpGroupMap = new Map<string, CpGroup>();
  for (const r of enRepartoRows) {
    const key = r.cp || "—";
    const g = cpGroupMap.get(key) ?? { cp: key, localidad: r.localidad, rows: [] };
    g.rows.push(r);
    cpGroupMap.set(key, g);
  }
  const enRepartoGroups = Array.from(cpGroupMap.values()).sort((a, b) => b.rows.length - a.rows.length);
  const volumeByCp = enRepartoGroups.map((g) => ({ name: g.cp, total: g.rows.length }));

  const clienteMap = new Map<string, number>();
  for (const r of enRepartoRows) {
    const key = r.cliente || "— Sin cliente —";
    clienteMap.set(key, (clienteMap.get(key) ?? 0) + 1);
  }
  const volumeByCliente = Array.from(clienteMap.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  // ---- Reporte 2: Flow Meeting por CP ----
  const flowMap = new Map<string, { entregados: number; enReparto: number; cancelados: number; fallos: number; total: number }>();
  for (const r of todayLocalRows) {
    const key = r.cp || "—";
    const b = flowMap.get(key) ?? { entregados: 0, enReparto: 0, cancelados: 0, fallos: 0, total: 0 };
    b.total++;
    if (isDeliveredEstado(r.estado)) b.entregados++;
    else if (isEnRepartoEstado(r.estado)) b.enReparto++;
    else if (isCancelarEstado(r.estado)) b.cancelados++;
    else if (isFailedEstado(r.estado)) b.fallos++;
    flowMap.set(key, b);
  }
  const flow: FlowRow[] = Array.from(flowMap.entries())
    .map(([cp, b]) => ({
      cp,
      localidad: localidadForCp(cp, cpMapping),
      ...b,
      pctEntrega: b.total > 0 ? (b.entregados / b.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // ---- Reporte 3: CD4 (universo completo de cliente local, todas las fechas) ----
  const byWaybill = new Map<string, RawRow[]>();
  for (const r of localRows) {
    const arr = byWaybill.get(r.waybill) ?? [];
    arr.push(r);
    byWaybill.set(r.waybill, arr);
  }
  const cd4: Cd4Row[] = [];
  for (const [waybill, rs] of byWaybill) {
    const sorted = [...rs].sort((a, b) => {
      const at = a.fecha!.getTime();
      const bt = b.fecha!.getTime();
      if (at === bt) return a.rowIndex - b.rowIndex;
      return at - bt;
    });
    const t0 = dayStart(sorted[0].fecha!);
    const onEpodDate = sorted.filter((r) => dayStart(r.fecha!) === maxTs);
    if (onEpodDate.length === 0) continue;
    const last = onEpodDate[onEpodDate.length - 1];
    if (!isEnRepartoEstado(last.estado)) continue;
    const dias = Math.floor((maxTs - t0) / 86400000);
    if (dias < 4) continue;
    cd4.push({
      waybill,
      cp: last.cp,
      localidad: localidadForCp(last.cp, cpMapping),
      dias,
      cliente: last.cliente,
      driver: last.driver,
    });
  }
  cd4.sort((a, b) => b.dias - a.dias);

  return {
    epodDate,
    enRepartoGroups,
    enRepartoTotal: enRepartoRows.length,
    volumeByCp,
    volumeByCliente,
    flow,
    cd4,
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

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function ClientesLocalesPage() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => {
    if (!rows) return null;
    const config = getClientesLocalesConfig();
    return analyze(rows, config.cpMapping);
  }, [rows]);

  const handleFile = async (f: File | null) => {
    setFile(f);
    setRows(null);
    setError(null);
    if (!f) return;
    setLoading(true);
    try {
      const config = getClientesLocalesConfig();
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
      const parsed: RawRow[] = json.map((r, i) => {
        const mercado = String(r[cols.mercado] ?? "").trim();
        const vendedor = String(r[cols.vendedor] ?? "").trim();
        return {
          waybill: String(r[cols.waybill] ?? "").trim(),
          fecha: parseFecha(r[cols.fecha]),
          estado: String(r[cols.estado] ?? "").trim(),
          cp: String(r[cols.cp] ?? "").trim(),
          direccion: String(r[cols.direccion] ?? "").trim(),
          driver: String(r[cols.driver] ?? "").trim(),
          mercado,
          vendedor,
          cliente: mercado || vendedor,
          clienteLocal: isClienteLocal(mercado, vendedor, config),
          rowIndex: i,
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

  const exportEnReparto = () => {
    if (!analysis) return;
    const rowsOut = analysis.enRepartoGroups.flatMap((g) =>
      g.rows.map((r) => [r.waybill, r.direccion, r.cliente, r.cp, r.localidad, r.driver]),
    );
    if (rowsOut.length === 0) return;
    exportStyledExcel({
      title: "Clientes Locales en Reparto",
      date: formatDate(analysis.epodDate),
      headers: ["Waybill", "Dirección", "Cliente", "CP", "Localidad", "Driver"],
      rows: rowsOut,
      filename: `clientes_locales_en_reparto_${formatDate(analysis.epodDate)}.xlsx`,
      colWidths: [22, 40, 24, 10, 20, 22],
    });
  };

  const exportFlow = () => {
    if (!analysis || analysis.flow.length === 0) return;
    exportStyledExcel({
      title: "Clientes Locales — Flow Meeting",
      date: formatDate(analysis.epodDate),
      headers: ["CP", "Localidad", "Total", "Entregados", "En Reparto", "Cancelados", "Fallos", "% Entrega"],
      rows: analysis.flow.map((f) => [f.cp, f.localidad, f.total, f.entregados, f.enReparto, f.cancelados, f.fallos, Number(f.pctEntrega.toFixed(1))]),
      filename: `clientes_locales_flow_meeting_${formatDate(analysis.epodDate)}.xlsx`,
      colWidths: [10, 20, 8, 12, 12, 12, 10, 12],
    });
  };

  const exportCd4 = () => {
    if (!analysis || analysis.cd4.length === 0) return;
    exportStyledExcel({
      title: "Clientes Locales — CD4",
      date: formatDate(analysis.epodDate),
      headers: ["Waybill", "CP", "Localidad", "Días desde Inbound", "Cliente", "Driver"],
      rows: analysis.cd4.map((r) => [r.waybill, r.cp, r.localidad, r.dias, r.cliente, r.driver]),
      filename: `clientes_locales_cd4_${formatDate(analysis.epodDate)}.xlsx`,
      colWidths: [22, 10, 20, 18, 24, 22],
      rowFill: (row) => (Number(row[3]) >= 6 ? "FADBD8" : undefined),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link
          to="/reportes"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Volver a Reportes
        </Link>
        <Link
          to="/reportes/clientes-locales/admin"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <Settings className="size-3.5" /> Configuración
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Clientes Locales</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Clientes locales en reparto, flow meeting por CP y CD4, a partir de un ePOD.
          {analysis && (
            <>
              {" "}Fecha del EPOD <strong>{formatDate(analysis.epodDate)}</strong>
            </>
          )}
        </p>
      </header>

      <Card className="shadow-none">
        <CardContent className="pt-6">
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
                  <div className="text-sm font-semibold text-foreground">Sube el Excel EPOD (Cainiao)</div>
                  <div className="text-xs">.xlsx · Arrastra aquí o haz click</div>
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
        </CardContent>
      </Card>

      {analysis && (
        <Tabs defaultValue="enreparto">
          <TabsList>
            <TabsTrigger value="enreparto">Clientes Locales en Reparto</TabsTrigger>
            <TabsTrigger value="flow">Flow Meeting</TabsTrigger>
            <TabsTrigger value="cd4">CD4</TabsTrigger>
          </TabsList>

          {/* REPORTE 1 */}
          <TabsContent value="enreparto" className="flex flex-col gap-4 mt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {analysis.enRepartoTotal} paquetes en reparto de clientes locales
              </p>
              <Button onClick={exportEnReparto} disabled={analysis.enRepartoTotal === 0} size="sm" className="gap-2">
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

            {analysis.enRepartoGroups.length === 0 ? (
              <Card className="shadow-none"><CardContent className="pt-6 text-sm text-muted-foreground">Sin clientes locales en reparto ✓</CardContent></Card>
            ) : (
              <div className="flex flex-col gap-4">
                {analysis.enRepartoGroups.map((g) => (
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
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.rows.map((r) => (
                          <TableRow key={r.waybill}>
                            <TableCell className="whitespace-nowrap">{r.waybill}</TableCell>
                            <TableCell className="max-w-[320px] truncate" title={r.direccion}>{r.direccion || "—"}</TableCell>
                            <TableCell>{r.cliente || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.driver || "—"}</TableCell>
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
                        <Td right className="tabular-nums font-semibold" >
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
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.cd4.map((r) => {
                      const critical = r.dias >= 6;
                      return (
                        <tr key={r.waybill} className={`border-t border-border ${critical ? "bg-destructive/10" : ""}`}>
                          <Td className="whitespace-nowrap">{r.waybill}</Td>
                          <Td className="whitespace-nowrap">{r.cp}</Td>
                          <Td>{r.localidad}</Td>
                          <Td right className={`tabular-nums font-semibold ${critical ? "text-destructive" : ""}`}>{r.dias}d</Td>
                          <Td>{r.cliente || "—"}</Td>
                          <Td className="whitespace-nowrap">{r.driver || "—"}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
