import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  Upload,
  X,
  Check,
  Loader2,
  AlertCircle,
  FileSpreadsheet,
  ArrowUpRight,
  BarChart3,
  FileText,
  Trash2,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/epod")({
  component: () => (
    <RequireAuth path="/epod">
      <EpodPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — ePOD" },
      {
        name: "description",
        content:
          "Sube el ePOD diario para alimentar el dashboard, los reportes y los borradores automáticamente.",
      },
    ],
  }),
});

// ============================================================
// COLUMN MAPPING (Spanish / English)
// ============================================================

const COL = {
  waybill: ["Número de Waybill", "Waybill No", "Waybill"],
  lp: ["LP No.", "LPNo", "LP No"],
  fecha: ["Fecha de la tarea", "Task Date", "Date"],
  fecha_inbound: ["Fecha Inbound", "Inbound Date"],
  estado: ["Estado de la Tarea", "Task Status", "Status"],
  tipo: ["Tipo de Entrega", "Delivery Type"],
  driver: ["Nombre del Repartidor", "Courier Name", "Driver"],
  cp: ["Código postal", "Zip Code", "Postcode"],
  direccion: ["Dirección detallada", "Detailed address", "Address"],
  contacto: ["Contacto", "Contact"],
  popStationId: ["popStationId", "Pop Station Id", "PopStationId"],
};

function normalizeKey(k: string) {
  return k.toLowerCase().replace(/[\s._-]+/g, "");
}
function pickField(row: Record<string, unknown>, candidates: string[]): string {
  const map = new Map<string, string>();
  for (const k of Object.keys(row)) map.set(normalizeKey(k), k);
  for (const c of candidates) {
    const key = map.get(normalizeKey(c));
    if (key != null) {
      const v = row[key];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
  }
  return "";
}

function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s);
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m2) return m2[0];
  return null;
}

function normalizeEstado(s: string): string {
  const v = (s || "").trim();
  const lower = v.toLowerCase();
  if (lower === "delivered") return "Entregado";
  if (lower === "cancel" || lower === "cancelled") return "Cancelar";
  if (lower === "attempt failure") return "Attempt Failure";
  if (lower === "driver_received") return "Driver_received";
  if (lower === "assigned") return "Assigned";
  return v || "Desconocido";
}

function normalizeTipo(t: string): "PUDO" | "TO_DOOR" {
  const v = (t || "").trim().toUpperCase();
  if (["PUDO", "TO_LOCKER", "PICK_UP_PUDO", "PICU_UP_PUDO"].includes(v)) return "PUDO";
  return "TO_DOOR";
}

// ============================================================
// PARSED ROW
// ============================================================

type ParsedRow = {
  lp_no: string;
  waybill: string | null;
  fecha: string | null;
  fecha_inbound: string | null;
  estado: string;
  tipo_entrega: string | null;
  tipo_norm: "PUDO" | "TO_DOOR";
  es_aa: boolean;
  driver: string | null;
  codigo_postal: string | null;
  direccion: string | null;
  contacto: string | null;
  pop_station_id: string | null;
};

function rawField(row: Record<string, unknown>, candidates: string[]): unknown {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const k = keys.find((kk) => normalizeKey(kk) === normalizeKey(c));
    if (k != null && row[k] !== "" && row[k] != null) return row[k];
  }
  return null;
}

function processEpod(rows: Record<string, unknown>[]): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (const r of rows) {
    const lp = pickField(r, COL.lp);
    if (!lp) continue;
    const rawDriver = pickField(r, COL.driver);
    const driver = rawDriver ? rawDriver.split(" | ")[0].trim() : null;
    const rawTipo = pickField(r, COL.tipo);
    out.push({
      lp_no: lp,
      waybill: pickField(r, COL.waybill) || null,
      fecha: parseDate(rawField(r, COL.fecha)),
      fecha_inbound: parseDate(rawField(r, COL.fecha_inbound)),
      estado: normalizeEstado(pickField(r, COL.estado)),
      tipo_entrega: rawTipo || null,
      tipo_norm: normalizeTipo(rawTipo),
      es_aa: false,
      driver,
      codigo_postal: pickField(r, COL.cp) || null,
      direccion: pickField(r, COL.direccion) || null,
      contacto: pickField(r, COL.contacto) || null,
      pop_station_id: pickField(r, COL.popStationId) || null,
    });
  }


  // AA modelo detection (TO_DOOR only, same contacto+direccion+fecha)
  const aaCount = new Map<string, number>();
  const keyFor = (r: ParsedRow) =>
    `${(r.contacto ?? "").toLowerCase()}|${(r.direccion ?? "").toLowerCase()}|${r.fecha ?? ""}`;
  for (const r of out) {
    if (r.tipo_norm !== "TO_DOOR") continue;
    if (!r.contacto || !r.direccion || !r.fecha) continue;
    aaCount.set(keyFor(r), (aaCount.get(keyFor(r)) ?? 0) + 1);
  }
  for (const r of out) {
    if (r.tipo_norm === "TO_DOOR" && (aaCount.get(keyFor(r)) ?? 0) >= 2) {
      r.es_aa = true;
    }
  }
  return out;
}

// ============================================================
// PAGE
// ============================================================

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

type UploadHistory = {
  id: string;
  filename: string;
  fecha_epod: string | null;
  total_paquetes: number;
  total_entregados: number;
  total_duplicados: number;
  procesado: boolean;
  created_at: string;
};

type ProcessResult = {
  total: number;
  entregados: number;
  fallos: number;
  duplicados: number;
  aaModelo: number;
};

function EpodPage() {
  const { selectedHub, user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [history, setHistory] = useState<UploadHistory[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadHistory = async () => {
    if (!selectedHub) return;
    const { data } = await supabase
      .from("epod_uploads")
      .select(
        "id, filename, fecha_epod, total_paquetes, total_entregados, total_duplicados, procesado, created_at",
      )
      .eq("hub_id", selectedHub.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setHistory((data ?? []) as UploadHistory[]);
  };

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHub?.id]);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleteUpload = async (u: UploadHistory) => {
    if (!selectedHub) return;
    if (!confirm(`¿Eliminar ePOD "${u.filename}" y todas sus entregas asociadas? Esta acción no se puede deshacer.`)) return;
    setDeletingId(u.id);
    try {
      const { error: eErr } = await supabase
        .from("entregas")
        .delete()
        .eq("hub_id", selectedHub.id)
        .eq("epod_upload_id", u.id);
      if (eErr) throw eErr;
      const { error: uErr } = await supabase
        .from("epod_uploads")
        .delete()
        .eq("id", u.id);
      if (uErr) throw uErr;
      toast.success("ePOD eliminado");
      await loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo eliminar");
    } finally {
      setDeletingId(null);
    }
  };

  const handleFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) {
      setError("Por favor sube un archivo Excel (.xlsx)");
      return;
    }
    setError(null);
    setResult(null);
    setFile(f);
  };

  const clearFile = () => {
    setFile(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const procesar = async () => {
    if (!file || !selectedHub) return;
    setProcessing(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (rows.length === 0) throw new Error("El archivo ePOD está vacío");

      const parsed = processEpod(rows);
      if (parsed.length === 0) {
        throw new Error("No se detectaron filas válidas en el ePOD (LP No. requerido)");
      }

      const entregados = parsed.filter((r) => r.estado === "Entregado").length;
      const fallos = parsed.filter((r) => r.estado === "Attempt Failure").length;
      const aaModelo = parsed.filter((r) => r.es_aa).length;

      // Determine fecha_epod
      const dates = parsed.map((r) => r.fecha).filter((d): d is string => !!d).sort();
      const fecha_epod = dates[0] ?? null;

      // Insert upload record (duplicados counted after upsert)
      const { data: upload, error: uErr } = await supabase
        .from("epod_uploads")
        .insert({
          hub_id: selectedHub.id,
          user_id: user?.id ?? null,
          filename: file.name,
          fecha_epod,
          total_paquetes: parsed.length,
          total_entregados: entregados,
          total_duplicados: 0,
          procesado: true,
        })
        .select("id")
        .single();
      if (uErr || !upload) throw uErr ?? new Error("No se pudo registrar el upload");

      // De-duplicate within this file (keep first occurrence per lp_no)
      const seen = new Set<string>();
      const unique = parsed.filter((r) => {
        if (seen.has(r.lp_no)) return false;
        seen.add(r.lp_no);
        return true;
      });

      const payload = unique.map((r) => ({
        hub_id: selectedHub.id,
        epod_upload_id: upload.id,
        lp_no: r.lp_no,
        waybill: r.waybill,
        fecha: r.fecha,
        fecha_inbound: r.fecha_inbound,
        estado: r.estado,
        tipo: r.tipo_entrega,
        tipo_norm: r.tipo_norm,
        es_aa: r.es_aa,
        driver: r.driver,
        cp: r.codigo_postal,
        direccion: r.direccion,
        contacto: r.contacto,
        pop_station_id: r.pop_station_id,
        source: "epod",
      }));

      const linePayload = parsed.map((r, index) => ({
        hub_id: selectedHub.id,
        epod_upload_id: upload.id,
        row_index: index + 2,
        lp_no: r.lp_no,
        waybill: r.waybill,
        fecha: r.fecha,
        fecha_inbound: r.fecha_inbound,
        estado: r.estado,
        tipo: r.tipo_entrega,
        tipo_norm: r.tipo_norm,
        driver: r.driver,
        cp: r.codigo_postal,
        direccion: r.direccion,
        contacto: r.contacto,
        pop_station_id: r.pop_station_id,
        source: "epod",
      }));

      // Upsert in parallel batches; ignore-duplicates returns only inserted rows
      const chunk = 1000;
      const concurrency = 4;
      for (let i = 0; i < linePayload.length; i += chunk) {
        const { error: lineErr } = await supabase
          .from("epod_lineas")
          .insert(linePayload.slice(i, i + chunk));
        if (lineErr) throw lineErr;
      }

      const chunks: typeof payload[] = [];
      for (let i = 0; i < payload.length; i += chunk) {
        chunks.push(payload.slice(i, i + chunk));
      }
      let inserted = 0;
      setProgress({ done: 0, total: chunks.length });
      for (let i = 0; i < chunks.length; i += concurrency) {
        const batch = chunks.slice(i, i + concurrency);
        const results = await Promise.all(
          batch.map((c) =>
            supabase
              .from("entregas")
              .upsert(c, { onConflict: "hub_id,lp_no", ignoreDuplicates: true })
              .select("lp_no"),
          ),
        );
        for (const { data, error: iErr } of results) {
          if (iErr) throw iErr;
          inserted += data?.length ?? 0;
        }
        setProgress({ done: Math.min(i + concurrency, chunks.length), total: chunks.length });
      }
      const duplicados = parsed.length - inserted;

      // Update upload record with final duplicados count
      await supabase
        .from("epod_uploads")
        .update({ total_duplicados: duplicados })
        .eq("id", upload.id);

      setResult({
        total: parsed.length,
        entregados,
        fallos,
        duplicados,
        aaModelo,
      });
      toast.success(`ePOD procesado: ${inserted} nuevos paquetes`);
      await loadHistory();
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error procesando el ePOD";
      setError(msg);
      toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="ePOD" />

      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-4xl mx-auto space-y-12">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Subir ePOD
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sube el ePOD diario para actualizar el dashboard, reportes y borradores automáticamente.
              {selectedHub && (
                <span className="block mt-1 text-xs text-muted-foreground/80">
                  Hub: {selectedHub.marca} · {selectedHub.nombre}
                </span>
              )}
            </p>
          </header>

          {!selectedHub ? (
            <div className="px-4 py-6 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs rounded-r">
              Selecciona un hub en la barra superior para empezar.
            </div>
          ) : (
            <>
              {/* UPLOAD ZONE */}
              <section className="animate-fade-up" style={{ animationDelay: "60ms" }}>
                {!file ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      handleFile(e.dataTransfer.files?.[0]);
                    }}
                    onClick={() => inputRef.current?.click()}
                    className={`group relative border-2 border-dashed transition-colors p-14 flex flex-col items-center justify-center rounded-lg cursor-pointer ${
                      dragOver
                        ? "border-electric bg-electric/[0.04]"
                        : "border-surface-3 hover:border-electric/50 hover:bg-ink/[0.02]"
                    }`}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="sr-only"
                      onChange={(e) => handleFile(e.target.files?.[0])}
                    />
                    <div className="size-14 bg-surface-2 rounded-md flex items-center justify-center mb-4 ring-1 ring-hairline">
                      <Upload className="size-6 text-electric" strokeWidth={1.75} />
                    </div>
                    <h3 className="font-syne text-lg mb-1.5 text-ink">
                      Cargar archivo ePOD .xlsx
                    </h3>
                    <p className="text-muted-text text-xs font-mono tracking-widest uppercase">
                      Arrastra o haz click para seleccionar
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-4 p-5 bg-surface border border-hairline rounded-lg">
                    <div className="size-10 bg-electric/10 border border-electric/30 rounded flex items-center justify-center shrink-0">
                      <FileSpreadsheet className="size-5 text-electric" strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm text-ink truncate">{file.name}</div>
                      <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase mt-0.5">
                        {formatSize(file.size)} · LISTO PARA PROCESAR
                      </div>
                    </div>
                    <button
                      onClick={clearFile}
                      className="size-8 rounded grid place-items-center text-muted-text hover:text-ink hover:bg-ink/5 transition-colors"
                      aria-label="Quitar archivo"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )}

                {error && (
                  <div className="mt-3 px-4 py-2.5 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs rounded-r flex items-center gap-2">
                    <AlertCircle className="size-3.5" />
                    {error}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-end gap-3">
                  {processing && progress && (
                    <span className="font-mono text-[10px] tracking-widest uppercase text-muted-text">
                      Subiendo {progress.done}/{progress.total} lotes
                    </span>
                  )}
                  <button
                    onClick={procesar}
                    disabled={!file || processing}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-electric text-white rounded-md font-mono text-xs tracking-widest uppercase hover:bg-electric/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {processing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    {processing ? "Procesando..." : "Procesar ePOD"}
                  </button>
                </div>
              </section>


              {/* RESULTS */}
              {result && (
                <section className="animate-fade-up bg-surface border border-hairline rounded-lg p-6 lg:p-8">
                  <h2 className="font-syne font-bold text-xl text-ink mb-5 tracking-tight">
                    Resumen del procesamiento
                  </h2>
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                    <StatBlock label="Paquetes" value={result.total} />
                    <StatBlock label="Entregados" value={result.entregados} accent />
                    <StatBlock label="Attempt Failures" value={result.fallos} />
                    <StatBlock label="AA modelo" value={result.aaModelo} />
                    <StatBlock label="Duplicados omitidos" value={result.duplicados} muted />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      to="/dashboard"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded font-mono text-xs tracking-widest uppercase hover:bg-ink/90 transition-colors"
                    >
                      <BarChart3 className="size-3.5" /> Ver dashboard
                    </Link>
                    <Link
                      to="/reportes"
                      className="inline-flex items-center gap-2 px-4 py-2 border border-hairline text-ink rounded font-mono text-xs tracking-widest uppercase hover:border-electric hover:text-electric transition-colors"
                    >
                      <FileText className="size-3.5" /> Generar reportes
                    </Link>
                  </div>
                </section>
              )}

              {/* HISTORY */}
              <section className="animate-fade-up">
                <h2 className="text-base font-semibold tracking-tight text-foreground mb-4">
                  Historial de uploads
                </h2>
                <div className="bg-surface border border-hairline rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-surface-2 border-b border-hairline font-mono text-[10px] tracking-widest uppercase text-muted-text">
                          <th className="text-left px-4 py-3">Fecha</th>
                          <th className="text-left px-4 py-3">Archivo</th>
                          <th className="text-right px-4 py-3">Paquetes</th>
                          <th className="text-right px-4 py-3">Entregados</th>
                          <th className="text-right px-4 py-3">Dupes</th>
                          <th className="text-left px-4 py-3">Estado</th>
                          <th className="text-right px-4 py-3 w-12"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.length === 0 ? (
                          <tr>
                            <td
                              colSpan={7}
                              className="px-4 py-8 text-center text-muted-text font-mono text-xs"
                            >
                              Sin uploads aún
                            </td>
                          </tr>
                        ) : (
                          history.map((h) => (
                            <tr key={h.id} className="border-b border-hairline/50">
                              <td className="px-4 py-2.5 font-mono text-xs text-ink">
                                {h.fecha_epod ?? h.created_at.slice(0, 10)}
                              </td>
                              <td className="px-4 py-2.5 text-ink truncate max-w-[260px]">
                                {h.filename}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums">
                                {h.total_paquetes.toLocaleString("es-ES")}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-electric">
                                {h.total_entregados.toLocaleString("es-ES")}
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-muted-text">
                                {h.total_duplicados.toLocaleString("es-ES")}
                              </td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono tracking-widest uppercase border ${
                                    h.procesado
                                      ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
                                      : "bg-amber-500/10 text-amber-700 border-amber-500/30"
                                  }`}
                                >
                                  {h.procesado ? (
                                    <>
                                      <Check className="size-3" /> Procesado
                                    </>
                                  ) : (
                                    "Pendiente"
                                  )}
                                </span>
                              </td>
                              <td className="px-2 py-2.5 text-right">
                                <button
                                  onClick={() => void deleteUpload(h)}
                                  disabled={deletingId === h.id}
                                  className="size-7 rounded grid place-items-center text-muted-text hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-40"
                                  aria-label="Eliminar ePOD"
                                  title="Eliminar ePOD"
                                >
                                  {deletingId === h.id ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="size-3.5" />
                                  )}
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center gap-1 text-xs font-mono tracking-widest uppercase text-muted-text hover:text-electric transition-colors"
                  >
                    Ver dashboard <ArrowUpRight className="size-3" />
                  </Link>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatBlock({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: number;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="border border-hairline rounded-md p-4 bg-background">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-text mb-1.5">
        {label}
      </div>
      <div
        className={`font-playfair italic font-extrabold text-2xl tabular-nums ${
          accent ? "text-electric" : muted ? "text-muted-text" : "text-ink"
        }`}
      >
        {value.toLocaleString("es-ES")}
      </div>
    </div>
  );
}
