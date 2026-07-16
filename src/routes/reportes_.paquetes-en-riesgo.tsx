import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import XLSXStyle from "xlsx-js-style";
import {
  Upload,
  FileSpreadsheet,
  X,
  AlertCircle,
  AlertTriangle,
  Download,
  ArrowLeft,
  ChevronDown,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";

export const Route = createFileRoute("/reportes_/paquetes-en-riesgo")({
  component: () => (
    <RequireAuth path="/reportes">
      <PaquetesEnRiesgoPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Paquetes en Riesgo" },
      {
        name: "description",
        content:
          "Detecta paquetes en reparto que rompen CD5 (5+ días desde inbound).",
      },
    ],
  }),
});

const HUBS = [
  "Catalyx",
  "Montjuïc",
  "Luan Express",
  "Sendily",
  "Zerol",
  "Blackstork",
] as const;
type HubKey = (typeof HUBS)[number];

const REQUIRED_COLS = [
  "Número de Waybill",
  "Fecha de la tarea",
  "Estado de la Tarea",
  "Detalles de la Excepción",
  "Código postal",
  "La ciudad de destino",
  "Dirección detallada",
  "Nombre del Repartidor",
] as const;

const EN_REPARTO_ESTADOS = new Set(["Driver_received", "Driver_received_incidencias"]);

type RawRow = {
  waybill: string;
  fecha: Date | null;
  fechaRaw: string;
  estado: string;
  incidencia: string;
  cp: string;
  ciudad: string;
  direccion: string;
  repartidor: string;
  rowIndex: number;
};

type RiskRow = {
  waybill: string;
  diasDesdeInbound: number;
  numIncidencias: number;
  ultimaIncidencia: string;
  cp: string;
  ciudad: string;
  direccion: string;
  repartidor: string;
};

function parseFecha(v: unknown): { d: Date | null; raw: string } {
  if (v == null || v === "") return { d: null, raw: "" };
  if (v instanceof Date) return { d: v, raw: v.toISOString() };
  if (typeof v === "number") {
    const utcDays = Math.floor(v - 25569);
    const utcMs = utcDays * 86400 * 1000 + (v - Math.floor(v)) * 86400 * 1000;
    const d = new Date(utcMs);
    return { d, raw: d.toISOString() };
  }
  const s = String(v).trim();
  // try native Date; supports "YYYY-MM-DD HH:mm:ss" and ISO
  const d = new Date(s.replace(" ", "T"));
  return { d: isNaN(d.getTime()) ? null : d, raw: s };
}

function dayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function analyze(rows: RawRow[]): { maxDate: Date | null; risk: RiskRow[] } {
  const validDates = rows.map((r) => r.fecha).filter((x): x is Date => !!x);
  if (validDates.length === 0) return { maxDate: null, risk: [] };
  const maxTs = Math.max(...validDates.map(dayStart));
  const maxDate = new Date(maxTs);

  const byWaybill = new Map<string, RawRow[]>();
  for (const r of rows) {
    if (!r.waybill) continue;
    const arr = byWaybill.get(r.waybill) ?? [];
    arr.push(r);
    byWaybill.set(r.waybill, arr);
  }

  const risk: RiskRow[] = [];
  for (const [waybill, rs] of byWaybill) {
    const sorted = [...rs].sort((a, b) => {
      const at = a.fecha ? a.fecha.getTime() : 0;
      const bt = b.fecha ? b.fecha.getTime() : 0;
      if (at === bt) return a.rowIndex - b.rowIndex;
      return at - bt;
    });
    // Last row of the max date (if any)
    const rowsOnMax = sorted.filter((r) => r.fecha && dayStart(r.fecha) === maxTs);
    if (rowsOnMax.length === 0) continue;
    const lastOnMax = rowsOnMax[rowsOnMax.length - 1];
    if (!EN_REPARTO_ESTADOS.has(lastOnMax.estado)) continue;

    const inboundTs = sorted[0].fecha ? dayStart(sorted[0].fecha) : maxTs;
    const dias = Math.floor((maxTs - inboundTs) / 86400000);
    if (dias < 5) continue;

    const withInc = sorted.filter((r) => r.incidencia.trim() !== "");
    const numIncidencias = withInc.length;
    const ultima = withInc.length > 0 ? withInc[withInc.length - 1].incidencia : "Sin incidencias";
    const last = sorted[sorted.length - 1];

    risk.push({
      waybill,
      diasDesdeInbound: dias,
      numIncidencias,
      ultimaIncidencia: ultima,
      cp: last.cp,
      ciudad: last.ciudad,
      direccion: last.direccion,
      repartidor: last.repartidor,
    });
  }
  risk.sort((a, b) => b.diasDesdeInbound - a.diasDesdeInbound);
  return { maxDate, risk };
}

function riskLevel(d: number): "critico" | "alto" | "medio" {
  if (d >= 10) return "critico";
  if (d >= 7) return "alto";
  return "medio";
}

function riskColors(level: "critico" | "alto" | "medio") {
  if (level === "critico") return { cell: "bg-red-700 text-white", hex: "B91C1C", fontHex: "FFFFFF" };
  if (level === "alto") return { cell: "bg-rose-300 text-red-900", hex: "FDA4AF", fontHex: "7F1D1D" };
  return { cell: "bg-[#F5E100] text-ink", hex: "F5E100", fontHex: "000000" };
}

function PaquetesEnRiesgoPage() {
  const [hub, setHub] = useState<HubKey | "">("");
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
    if (!hub) {
      setError("Selecciona un hub antes de subir el archivo.");
      setFile(null);
      return;
    }
    setLoading(true);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
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
      const parsed: RawRow[] = json.map((r, i) => {
        const f = parseFecha(r["Fecha de la tarea"]);
        return {
          waybill: String(r["Número de Waybill"] ?? "").trim(),
          fecha: f.d,
          fechaRaw: f.raw,
          estado: String(r["Estado de la Tarea"] ?? "").trim(),
          incidencia: String(r["Detalles de la Excepción"] ?? "").trim(),
          cp: String(r["Código postal"] ?? "").trim(),
          ciudad: String(r["La ciudad de destino"] ?? "").trim(),
          direccion: String(r["Dirección detallada"] ?? "").trim(),
          repartidor: String(r["Nombre del Repartidor"] ?? "").trim(),
          rowIndex: i,
        };
      });
      setRows(parsed);
      // Persist summary per hub
      const analysisNow = analyze(parsed);
      if (hub) {
        try {
          const key = "paquetes_en_riesgo_v1";
          const store = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<
            string,
            { fecha: string; total: number; updatedAt: string }
          >;
          store[hub] = {
            fecha: formatDate(analysisNow.maxDate),
            total: analysisNow.risk.length,
            updatedAt: new Date().toISOString(),
          };
          localStorage.setItem(key, JSON.stringify(store));
        } catch { /* ignore */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error leyendo el archivo.");
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const exportXlsx = () => {
    if (!analysis || analysis.risk.length === 0) return;
    const headers = [
      "Waybill",
      "Días desde Inbound",
      "N° Incidencias",
      "Última Incidencia",
      "CP",
      "Ciudad",
      "Dirección",
      "Repartidor",
    ];
    const aoa: (string | number)[][] = [headers];
    for (const r of analysis.risk) {
      aoa.push([
        r.waybill,
        r.diasDesdeInbound,
        r.numIncidencias,
        r.ultimaIncidencia,
        r.cp,
        r.ciudad,
        r.direccion,
        r.repartidor,
      ]);
    }
    const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
    // Header style
    const headerStyle = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { patternType: "solid", fgColor: { rgb: "111111" } },
      alignment: { horizontal: "center", vertical: "center" },
    };
    for (let c = 0; c < headers.length; c++) {
      const ref = XLSXStyle.utils.encode_cell({ r: 0, c });
      const cell = (ws as Record<string, unknown>)[ref] as { s?: unknown } | undefined;
      if (cell) cell.s = headerStyle;
    }
    // Color Días desde Inbound (col index 1)
    for (let i = 0; i < analysis.risk.length; i++) {
      const dias = analysis.risk[i].diasDesdeInbound;
      const { hex, fontHex } = riskColors(riskLevel(dias));
      const ref = XLSXStyle.utils.encode_cell({ r: i + 1, c: 1 });
      const cell = (ws as Record<string, unknown>)[ref] as { s?: unknown } | undefined;
      if (cell) {
        cell.s = {
          font: { bold: true, color: { rgb: fontHex } },
          fill: { patternType: "solid", fgColor: { rgb: hex } },
          alignment: { horizontal: "center" },
        };
      }
    }
    ws["!cols"] = [
      { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 32 },
      { wch: 8 }, { wch: 18 }, { wch: 40 }, { wch: 24 },
    ];
    const wb = XLSXStyle.utils.book_new();
    XLSXStyle.utils.book_append_sheet(wb, ws, "Riesgo");
    const buf = XLSXStyle.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `paquetes_en_riesgo_${hub}_${formatDate(analysis.maxDate)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Reportes" />

      <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-6xl mx-auto">
          <div className="mb-4">
            <Link
              to="/reportes"
              className="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted-text hover:text-ink"
            >
              <ArrowLeft className="size-3" /> Volver a Reportes
            </Link>
          </div>

          <header className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              PAQUETES EN RIESGO
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Paquetes en reparto que rompen <span className="italic font-serif">CD5</span> (5+ días desde inbound).
              Procesamiento local: nada se sube al servidor.
            </p>
          </header>

          {/* Hub selector */}
          <section className="mb-4">
            <label className="text-[11px] font-mono uppercase text-muted-text tracking-wide">
              Hub
            </label>
            <div className="mt-1 relative w-full max-w-xs">
              <select
                value={hub}
                onChange={(e) => {
                  setHub(e.target.value as HubKey | "");
                  void handleFile(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                className="w-full appearance-none pl-3 pr-8 py-2 text-sm bg-surface border border-hairline rounded-md text-ink font-syne"
              >
                <option value="">— Selecciona hub —</option>
                {HUBS.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-text" />
            </div>
          </section>

          {/* Dropzone */}
          <section className="mb-6">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFile(f);
              }}
              onClick={() => hub && inputRef.current?.click()}
              className={`p-5 bg-surface border-2 border-dashed rounded-lg transition-colors ${
                !hub
                  ? "border-hairline opacity-60 cursor-not-allowed"
                  : dragOver
                    ? "border-electric bg-electric/5 cursor-pointer"
                    : "border-hairline hover:border-electric/50 cursor-pointer"
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
                    <div className="text-sm font-semibold text-ink truncate">{file.name}</div>
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
                      {hub ? `Sube el Excel EPOD de ${hub}` : "Primero selecciona un hub"}
                    </div>
                    <div className="text-[11px] font-mono">
                      .xlsx · Arrastra aquí o haz click
                    </div>
                  </div>
                </div>
              )}
            </div>
            {loading && (
              <p className="mt-2 text-[12px] font-mono text-muted-text">Procesando…</p>
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
              <section className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-lg border bg-[#F5E100] border-[#F5E100] text-ink">
                  <div className="text-[11px] font-mono uppercase tracking-wide opacity-70">
                    Paquetes en riesgo
                  </div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">
                    {analysis.risk.length.toLocaleString("es-ES")}
                  </div>
                  <div className="mt-1 text-[11px] font-mono opacity-70">
                    Rompen CD5 (≥5 días desde inbound)
                  </div>
                </div>
                <div className="p-4 rounded-lg border bg-surface border-hairline text-ink">
                  <div className="text-[11px] font-mono uppercase tracking-wide opacity-70">
                    Fecha del reporte
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">
                    {formatDate(analysis.maxDate)}
                  </div>
                  <div className="mt-1 text-[11px] font-mono opacity-60">
                    Última fecha del archivo
                  </div>
                </div>
                <div className="p-4 rounded-lg border bg-surface border-hairline text-ink flex flex-col justify-between">
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-wide opacity-70">Hub</div>
                    <div className="mt-1 text-2xl font-semibold">{hub}</div>
                  </div>
                  <button
                    onClick={exportXlsx}
                    disabled={analysis.risk.length === 0}
                    className="mt-2 self-start inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold font-syne tracking-tight rounded-md bg-ink text-white hover:bg-ink/90 disabled:bg-surface-2 disabled:text-muted-text disabled:cursor-not-allowed"
                  >
                    <Download className="size-3.5" /> Exportar Excel
                  </button>
                </div>
              </section>

              <section>
                {analysis.risk.length === 0 ? (
                  <div className="p-6 bg-surface border border-hairline rounded-lg text-sm text-ink">
                    Sin paquetes en riesgo ✓
                  </div>
                ) : (
                  <div className="bg-surface border border-hairline rounded-lg overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-2 text-[11px] font-mono uppercase text-muted-text">
                        <tr>
                          <th className="text-left px-3 py-2.5">Waybill</th>
                          <th className="text-center px-3 py-2.5">Días desde Inbound</th>
                          <th className="text-center px-3 py-2.5">N° Inc.</th>
                          <th className="text-left px-3 py-2.5">Última Incidencia</th>
                          <th className="text-left px-3 py-2.5">CP</th>
                          <th className="text-left px-3 py-2.5">Ciudad</th>
                          <th className="text-left px-3 py-2.5">Dirección</th>
                          <th className="text-left px-3 py-2.5">Repartidor</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {analysis.risk.map((r) => {
                          const level = riskLevel(r.diasDesdeInbound);
                          const colors = riskColors(level);
                          return (
                            <tr key={r.waybill} className="border-t border-hairline">
                              <td className="px-3 py-2 text-ink whitespace-nowrap">{r.waybill}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold tabular-nums ${colors.cell}`}>
                                  {level === "critico" && <AlertTriangle className="size-3" />}
                                  {r.diasDesdeInbound}d
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center text-ink tabular-nums">{r.numIncidencias}</td>
                              <td className="px-3 py-2 text-ink max-w-[280px] truncate" title={r.ultimaIncidencia}>{r.ultimaIncidencia}</td>
                              <td className="px-3 py-2 text-ink">{r.cp || "—"}</td>
                              <td className="px-3 py-2 text-ink">{r.ciudad || "—"}</td>
                              <td className="px-3 py-2 text-ink max-w-[280px] truncate" title={r.direccion}>{r.direccion || "—"}</td>
                              <td className="px-3 py-2 text-ink whitespace-nowrap">{r.repartidor || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
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
