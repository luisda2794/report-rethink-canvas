import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FileSpreadsheet,
  X,
  AlertCircle,
  Copy,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";

export const Route = createFileRoute("/duplicados")({
  component: () => (
    <RequireAuth path="/duplicados">
      <DuplicadosPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Duplicados" },
      {
        name: "description",
        content:
          "Detección de paquetes duplicados en el EPOD y cálculo de tasas reales vs. Cainiao.",
      },
    ],
  }),
});

const REQUIRED_COLS = [
  "Número de Waybill",
  "Fecha de la tarea",
  "Estado de la Tarea",
  "Detalles de la Excepción",
] as const;

type RawRow = {
  waybill: string;
  fecha: string;
  estado: string;
  incidencia: string;
  rowIndex: number;
};

type WaybillGroup = {
  waybill: string;
  rows: RawRow[];
  finalEstado: string;
};

type Analysis = {
  total: number;
  reales: number;
  duplicados: number;
  duplicadosPct: number;
  groups: WaybillGroup[];
  duplicatedGroups: WaybillGroup[];
  // Reales (dedup, último estado)
  entregadosReal: number;
  incidenciasReal: number;
  canceladosReal: number;
  entregaRealPct: number;
  incidenciasRealPct: number;
  canceladosRealPct: number;
  // Cainiao (todas las filas)
  entregadosCai: number;
  incidenciasCai: number;
  canceladosCai: number;
  entregaCaiPct: number;
  incidenciasCaiPct: number;
  canceladosCaiPct: number;
};

function normDate(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") {
    // Excel serial
    const utcDays = Math.floor(v - 25569);
    const utcMs = utcDays * 86400 * 1000 + (v - Math.floor(v)) * 86400 * 1000;
    return new Date(utcMs).toISOString();
  }
  return String(v).trim();
}

function analyze(rows: RawRow[]): Analysis {
  const total = rows.length;
  const byWaybill = new Map<string, RawRow[]>();
  for (const r of rows) {
    if (!r.waybill) continue;
    const arr = byWaybill.get(r.waybill) ?? [];
    arr.push(r);
    byWaybill.set(r.waybill, arr);
  }
  const groups: WaybillGroup[] = [];
  for (const [waybill, rs] of byWaybill) {
    // sort by fecha asc, then rowIndex asc; final = last
    const sorted = [...rs].sort((a, b) => {
      if (a.fecha === b.fecha) return a.rowIndex - b.rowIndex;
      return a.fecha < b.fecha ? -1 : 1;
    });
    const finalEstado = sorted[sorted.length - 1]?.estado ?? "";
    groups.push({ waybill, rows: sorted, finalEstado });
  }
  const reales = groups.length;
  const duplicados = total - reales;
  const duplicadosPct = total > 0 ? (duplicados / total) * 100 : 0;
  const duplicatedGroups = groups
    .filter((g) => g.rows.length > 1)
    .sort((a, b) => b.rows.length - a.rows.length);

  const entregadosReal = groups.filter((g) => g.finalEstado === "Entregado").length;
  const incidenciasReal = groups.filter((g) => g.finalEstado === "Attempt Failure").length;
  const canceladosReal = groups.filter((g) => g.finalEstado === "Cancelar").length;

  const entregadosCai = rows.filter((r) => r.estado === "Entregado").length;
  const incidenciasCai = rows.filter((r) => r.estado === "Attempt Failure").length;
  const canceladosCai = rows.filter((r) => r.estado === "Cancelar").length;

  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

  return {
    total,
    reales,
    duplicados,
    duplicadosPct,
    groups,
    duplicatedGroups,
    entregadosReal,
    incidenciasReal,
    canceladosReal,
    entregaRealPct: pct(entregadosReal, reales),
    incidenciasRealPct: pct(incidenciasReal, reales),
    canceladosRealPct: pct(canceladosReal, reales),
    entregadosCai,
    incidenciasCai,
    canceladosCai,
    entregaCaiPct: pct(entregadosCai, total),
    incidenciasCaiPct: pct(incidenciasCai, total),
    canceladosCaiPct: pct(canceladosCai, total),
  };
}

function DuplicadosPage() {
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
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("El archivo no tiene hojas.");
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: "",
        raw: true,
      });
      if (json.length === 0) throw new Error("El archivo está vacío.");
      const headers = Object.keys(json[0]);
      const missing = REQUIRED_COLS.filter((c) => !headers.includes(c));
      if (missing.length > 0) {
        throw new Error(
          `Faltan columnas: ${missing.join(", ")}. Verifica el formato del archivo.`,
        );
      }
      const parsed: RawRow[] = json.map((r, i) => ({
        waybill: String(r["Número de Waybill"] ?? "").trim(),
        fecha: normDate(r["Fecha de la tarea"]),
        estado: String(r["Estado de la Tarea"] ?? "").trim(),
        incidencia: String(r["Detalles de la Excepción"] ?? "").trim(),
        rowIndex: i,
      }));
      setRows(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error leyendo el archivo.");
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Duplicados" />

      <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-5xl mx-auto">
          <header className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              DUPLICADOS
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Detección de paquetes duplicados y cálculo de tasas{" "}
              <span className="italic font-serif">reales</span> vs.{" "}
              <span className="italic font-serif">Cainiao</span>. Procesamiento
              local: nada se sube al servidor.
            </p>
          </header>

          {/* Dropzone */}
          <section className="mb-6">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFile(f);
              }}
              onClick={() => inputRef.current?.click()}
              className={`p-5 bg-surface border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                dragOver
                  ? "border-electric bg-electric/5"
                  : "border-hairline hover:border-electric/50"
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
                  <FileSpreadsheet className="size-6 text-electric shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ink truncate">
                      {file.name}
                    </div>
                    <div className="text-[11px] text-muted-text font-mono">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                      {rows ? ` · ${rows.length} filas` : ""}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleFile(null);
                      if (inputRef.current) inputRef.current.value = "";
                    }}
                    className="p-1.5 rounded hover:bg-surface-2 text-muted-text hover:text-ink"
                    aria-label="Quitar archivo"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-muted-text">
                  <Upload className="size-6 text-electric" />
                  <div>
                    <div className="text-sm font-semibold text-ink">
                      Sube el Excel del EPOD del día
                    </div>
                    <div className="text-[11px] font-mono">
                      .xlsx · Arrastra aquí o haz click
                    </div>
                  </div>
                </div>
              )}
            </div>
            {loading && (
              <p className="mt-2 text-[12px] font-mono text-muted-text">
                Procesando…
              </p>
            )}
            {error && (
              <p className="mt-2 text-danger text-[12px] font-mono flex items-start gap-1.5">
                <AlertCircle className="size-3 mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </section>

          {analysis && (
            <>
              {/* KPI cards */}
              <section className="mb-8 grid grid-cols-2 md:grid-cols-4 gap-3">
                <KpiCard
                  label="Total registros"
                  value={analysis.total.toLocaleString("es-ES")}
                  hint="Filas del Excel (Cainiao)"
                />
                <KpiCard
                  label="Paquetes reales"
                  value={analysis.reales.toLocaleString("es-ES")}
                  hint="Waybills únicos"
                />
                <KpiCard
                  label="Duplicados"
                  value={analysis.duplicados.toLocaleString("es-ES")}
                  hint={`${analysis.duplicatedGroups.length} waybills repetidos`}
                  accent
                />
                <KpiCard
                  label="% diferencia"
                  value={`${analysis.duplicadosPct.toFixed(1)}%`}
                  hint="Duplicados / Total"
                />
              </section>

              {/* Tabla comparativa */}
              <section className="mb-8">
                <h2 className="text-lg font-semibold tracking-tight mb-3">
                  REAL vs <span className="italic font-serif">Cainiao</span>
                </h2>
                <div className="bg-surface border border-hairline rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-2 text-[11px] font-mono uppercase text-muted-text">
                      <tr>
                        <th className="text-left px-4 py-2.5">Concepto</th>
                        <th className="text-right px-4 py-2.5">Real (dedup)</th>
                        <th className="text-right px-4 py-2.5">Cainiao (bruto)</th>
                        <th className="text-right px-4 py-2.5">Δ</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      <ComparisonRow
                        label="Entregados"
                        realAbs={analysis.entregadosReal}
                        realPct={analysis.entregaRealPct}
                        caiAbs={analysis.entregadosCai}
                        caiPct={analysis.entregaCaiPct}
                        higherIsBetter
                      />
                      <ComparisonRow
                        label="Incidencias"
                        realAbs={analysis.incidenciasReal}
                        realPct={analysis.incidenciasRealPct}
                        caiAbs={analysis.incidenciasCai}
                        caiPct={analysis.incidenciasCaiPct}
                        higherIsBetter={false}
                      />
                      <ComparisonRow
                        label="Cancelados"
                        realAbs={analysis.canceladosReal}
                        realPct={analysis.canceladosRealPct}
                        caiAbs={analysis.canceladosCai}
                        caiPct={analysis.canceladosCaiPct}
                        higherIsBetter={false}
                      />
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Detalle duplicados */}
              <section className="mb-12">
                <h2 className="text-lg font-semibold tracking-tight mb-3 flex items-center gap-2">
                  <Copy className="size-4 text-electric" />
                  Waybills duplicados
                  <span className="text-[11px] font-mono text-muted-text font-normal">
                    ({analysis.duplicatedGroups.length})
                  </span>
                </h2>
                {analysis.duplicatedGroups.length === 0 ? (
                  <div className="p-6 bg-surface border border-hairline rounded-lg text-sm text-muted-text">
                    No hay waybills duplicados en este archivo.
                  </div>
                ) : (
                  <div className="bg-surface border border-hairline rounded-lg divide-y divide-hairline">
                    {analysis.duplicatedGroups.map((g) => (
                      <DuplicateRow key={g.waybill} group={g} />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`p-4 rounded-lg border ${
        accent
          ? "bg-[#F5E100] border-[#F5E100] text-ink"
          : "bg-surface border-hairline text-ink"
      }`}
    >
      <div className="text-[11px] font-mono uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && (
        <div className="mt-1 text-[11px] font-mono opacity-60">{hint}</div>
      )}
    </div>
  );
}

function ComparisonRow({
  label,
  realAbs,
  realPct,
  caiAbs,
  caiPct,
  higherIsBetter,
}: {
  label: string;
  realAbs: number;
  realPct: number;
  caiAbs: number;
  caiPct: number;
  higherIsBetter: boolean;
}) {
  const delta = realPct - caiPct;
  const better = higherIsBetter ? delta > 0 : delta < 0;
  const worse = higherIsBetter ? delta < 0 : delta > 0;
  const cls = better
    ? "text-emerald-600"
    : worse
      ? "text-rose-600"
      : "text-muted-text";
  return (
    <tr className="border-t border-hairline">
      <td className="px-4 py-3 font-syne font-semibold text-ink">{label}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        <div className="text-ink">{realAbs.toLocaleString("es-ES")}</div>
        <div className="text-[11px] text-muted-text">{realPct.toFixed(2)}%</div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <div className="text-ink">{caiAbs.toLocaleString("es-ES")}</div>
        <div className="text-[11px] text-muted-text">{caiPct.toFixed(2)}%</div>
      </td>
      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${cls}`}>
        {delta >= 0 ? "+" : ""}
        {delta.toFixed(2)} pp
      </td>
    </tr>
  );
}

function DuplicateRow({ group }: { group: WaybillGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2 text-left"
      >
        {open ? (
          <ChevronDown className="size-4 text-muted-text" />
        ) : (
          <ChevronRight className="size-4 text-muted-text" />
        )}
        <div className="flex-1 font-mono text-sm text-ink truncate">
          {group.waybill}
        </div>
        <span className="text-[11px] font-mono text-muted-text">
          {group.rows.length}×
        </span>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-2 text-ink">
          {group.finalEstado || "—"}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <table className="w-full text-[12px] font-mono border border-hairline rounded overflow-hidden">
            <thead className="bg-surface-2 text-muted-text uppercase text-[10px]">
              <tr>
                <th className="text-left px-3 py-1.5">#</th>
                <th className="text-left px-3 py-1.5">Fecha</th>
                <th className="text-left px-3 py-1.5">Estado</th>
                <th className="text-left px-3 py-1.5">Incidencia</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((r, i) => (
                <tr key={i} className="border-t border-hairline">
                  <td className="px-3 py-1.5 text-muted-text">{i + 1}</td>
                  <td className="px-3 py-1.5 text-ink">{r.fecha || "—"}</td>
                  <td className="px-3 py-1.5 text-ink">{r.estado || "—"}</td>
                  <td className="px-3 py-1.5 text-ink">{r.incidencia || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
