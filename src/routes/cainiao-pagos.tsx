import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import Papa from "papaparse";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, X, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/cainiao-pagos")({
  component: () => (
    <RequireAuth path="/cainiao-pagos">
      <CainiaoPagosPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Pagos Cainiao" },
      {
        name: "description",
        content: "Sube el bill quincenal de Cainiao y concilia contra lo entregado y lo pagado a drivers.",
      },
    ],
  }),
});

// ============================================================
// TRADUCCIÓN DE "Bill Item"
// ============================================================
// Confirmado con el usuario. Cualquier valor no listado se muestra tal cual
// (con una marca "(sin traducir)") en vez de fallar — Cainiao puede agregar
// conceptos nuevos que no vimos todavía.
const BILL_ITEM_ES: Record<string, string> = {
  "末端配送费-税率21%": "Tarifa de entrega final (21% IVA)",
  "挂号服务费": "Tarifa de servicio de registro",
  "货值赔付": "Compensación/Penalización por valor",
  "逆向揽配揽收费": "Tarifa de recogida inversa",
  "配送大促额外服务费": "Servicio extra de promoción",
};

function translateBillItem(raw: string): string {
  return BILL_ITEM_ES[raw] ?? `${raw} (sin traducir)`;
}

// ============================================================
// LECTURA FLEXIBLE DE COLUMNAS
// ============================================================
// Mismo patrón que /epod (pickField/normalizeKey): matchea el header exacto
// que confirmó el usuario, tolera variantes de espacios/mayúsculas. Para
// "Weight" y "Business Node Time" no tenemos el header exacto confirmado
// todavía — se intentan variantes razonables y quedan null si no aparecen,
// sin bloquear el resto del procesamiento.
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

const COL = {
  lp: ["Logistics Treasure Order Number"],
  billItem: ["Bill Item"],
  billAmount: ["Bill Amount"],
  billingTime: ["Billing Time"],
  businessNodeTime: ["Business Node Time", "Business node time", "BusinessNodeTime"],
  cp: ["International Postal Codes"],
  aaFirst: ["AAmodel First Order", "AAModel First Order"],
  aaCode: ["AAModel code", "AAmodel code"],
  weight: ["Weight(g)", "Weight (g)", "Weight", "Weight(G)"],
  currency: ["Charging currency", "Charging Currency"],
};

function parseAmount(v: string): number {
  if (!v) return 0;
  const n = Number(v.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseDateLoose(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// El LP no real confirmado por el usuario tiene el formato 'LP88436... — se
// quita el apóstrofe inicial y, si lo que queda no arranca con "LP", se
// guarda como null (ej. 'contingencyplanluan de un ajuste general del hub,
// no de un paquete concreto) — lp_no_raw siempre conserva el valor crudo.
function cleanLpNo(raw: string): string | null {
  const stripped = raw.replace(/^['‘’]/, "").trim();
  return /^LP/i.test(stripped) ? stripped : null;
}

type ParsedLinea = {
  lp_no: string | null;
  lp_no_raw: string;
  bill_item: string;
  bill_item_es: string;
  bill_amount: number;
  billing_time: string | null;
  business_node_time: string | null;
  codigo_postal: string | null;
  aamodel_first_order: string | null;
  aamodel_code: string | null;
  weight_g: number | null;
  charging_currency: string | null;
  raw: Record<string, unknown>;
};

function parseRow(row: Record<string, unknown>): ParsedLinea | null {
  const lpRaw = pickField(row, COL.lp);
  const billItem = pickField(row, COL.billItem);
  const billAmount = pickField(row, COL.billAmount);
  if (!billItem && !billAmount) return null; // fila vacía (linea en blanco al final del CSV)
  const weightStr = pickField(row, COL.weight);
  return {
    lp_no: lpRaw ? cleanLpNo(lpRaw) : null,
    lp_no_raw: lpRaw || "",
    bill_item: billItem,
    bill_item_es: translateBillItem(billItem),
    bill_amount: parseAmount(billAmount),
    billing_time: parseDateLoose(pickField(row, COL.billingTime)),
    business_node_time: parseDateLoose(pickField(row, COL.businessNodeTime)),
    codigo_postal: pickField(row, COL.cp) || null,
    aamodel_first_order: pickField(row, COL.aaFirst) || null,
    aamodel_code: pickField(row, COL.aaCode) || null,
    weight_g: weightStr ? Number(weightStr.replace(/,/g, "")) || null : null,
    charging_currency: pickField(row, COL.currency) || null,
    raw: row,
  };
}

function describeError(e: unknown): string {
  if (e && typeof e === "object") {
    const anyE = e as Record<string, unknown>;
    if (typeof anyE.message === "string" && anyE.message) {
      const details = typeof anyE.details === "string" ? anyE.details : undefined;
      const hint = typeof anyE.hint === "string" ? anyE.hint : undefined;
      return [anyE.message, details, hint && `(sugerencia: ${hint})`].filter(Boolean).join(" — ");
    }
  }
  return e instanceof Error ? e.message : "Error procesando el archivo";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================
// EXTRACCIÓN ZIP → CSV
// ============================================================
async function extractCsvFromZip(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file);
  const entry = Object.values(zip.files).find(
    (f) => !f.dir && f.name.toLowerCase().endsWith(".csv"),
  );
  if (!entry) throw new Error("El ZIP no contiene ningún archivo .csv adentro.");
  const text = await entry.async("string");
  // Quita el BOM UTF-8 si Papa no lo hace solo (algunas versiones lo dejan
  // como primer carácter, lo que rompe el nombre de la primera columna).
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

type UploadHistoryRow = {
  id: string;
  filename: string;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  total_filas: number | null;
  total_importe: number | null;
  uploaded_at: string;
};

function CainiaoPagosPage() {
  const { selectedHub, user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    totalFilas: number;
    totalImporte: number;
    periodoDesde: string | null;
    periodoHasta: string | null;
  } | null>(null);

  const [history, setHistory] = useState<UploadHistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadHistory = async () => {
    if (!selectedHub) return;
    setLoadingHistory(true);
    const { data, error: hErr } = await supabase
      .from("cainiao_bill_uploads")
      .select("id, filename, periodo_desde, periodo_hasta, total_filas, total_importe, uploaded_at")
      .eq("hub_id", selectedHub.id)
      .order("uploaded_at", { ascending: false })
      .limit(30);
    if (hErr) toast.error(hErr.message);
    setHistory((data ?? []) as UploadHistoryRow[]);
    setLoadingHistory(false);
  };

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHub?.id]);

  const handleFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".zip")) {
      toast.error("Subí el ZIP tal cual lo manda Cainiao (Consolidated_Bill_*.zip) — no lo descomprimas antes.");
      return;
    }
    setFile(f);
    setResult(null);
    setError(null);
  };

  const clearFile = () => {
    setFile(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const process = async () => {
    if (!file || !selectedHub || !user) return;
    setProcessing(true);
    setError(null);
    let uploadId: string | null = null;
    try {
      const csvText = await extractCsvFromZip(file);
      const parsed = Papa.parse<Record<string, unknown>>(csvText, {
        header: true,
        skipEmptyLines: true,
      });
      if (parsed.errors.length > 0) {
        console.error("[Cainiao] Errores de parseo CSV:", parsed.errors);
      }
      const lineas = parsed.data.map(parseRow).filter((l): l is ParsedLinea => l !== null);
      if (lineas.length === 0) throw new Error("No se encontraron filas válidas en el CSV.");

      const times = lineas.map((l) => l.billing_time).filter((t): t is string => !!t).sort();
      const periodoDesde = times[0] ? times[0].slice(0, 10) : null;
      const periodoHasta = times.length ? times[times.length - 1].slice(0, 10) : null;
      const totalImporte = lineas.reduce((acc, l) => acc + l.bill_amount, 0);

      const { data: uploadRow, error: uploadErr } = await supabase
        .from("cainiao_bill_uploads")
        .insert({
          hub_id: selectedHub.id,
          filename: file.name,
          periodo_desde: periodoDesde,
          periodo_hasta: periodoHasta,
          total_filas: lineas.length,
          total_importe: totalImporte,
          uploaded_by: user.id,
        })
        .select("id")
        .single();
      if (uploadErr) throw uploadErr;
      uploadId = uploadRow.id;

      const payload = lineas.map((l) => ({
        hub_id: selectedHub.id,
        upload_id: uploadId,
        lp_no: l.lp_no,
        lp_no_raw: l.lp_no_raw,
        bill_item: l.bill_item,
        bill_item_es: l.bill_item_es,
        bill_amount: l.bill_amount,
        billing_time: l.billing_time,
        business_node_time: l.business_node_time,
        codigo_postal: l.codigo_postal,
        aamodel_first_order: l.aamodel_first_order,
        aamodel_code: l.aamodel_code,
        weight_g: l.weight_g,
        charging_currency: l.charging_currency,
        raw: l.raw,
      }));

      const chunk = 500;
      setProgress({ done: 0, total: Math.ceil(payload.length / chunk) });
      for (let i = 0; i < payload.length; i += chunk) {
        const { error: lineErr } = await supabase.from("cainiao_bill_lineas").insert(payload.slice(i, i + chunk));
        if (lineErr) throw lineErr;
        setProgress({ done: Math.floor(i / chunk) + 1, total: Math.ceil(payload.length / chunk) });
      }

      setResult({ totalFilas: lineas.length, totalImporte, periodoDesde, periodoHasta });
      toast.success(`Bill de Cainiao procesado: ${lineas.length} filas`);
      await loadHistory();
      clearFile();
    } catch (e) {
      console.error("[Cainiao] Error procesando el bill:", e);
      const msg = describeError(e);
      setError(msg);
      toast.error(msg);
      if (uploadId) {
        await supabase.from("cainiao_bill_uploads").delete().eq("id", uploadId);
      }
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  const deleteUpload = async (u: UploadHistoryRow) => {
    if (!confirm(`¿Eliminar la subida "${u.filename}" y sus ${u.total_filas ?? 0} filas? Esta acción no se puede deshacer.`)) return;
    setDeletingId(u.id);
    const { error: delErr } = await supabase.from("cainiao_bill_uploads").delete().eq("id", u.id);
    if (delErr) toast.error(delErr.message);
    else {
      toast.success("Subida eliminada");
      await loadHistory();
    }
    setDeletingId(null);
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Pagos Cainiao" />
      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-4xl mx-auto space-y-10">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Pagos Cainiao</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Hub:{" "}
              <span className="text-foreground font-medium">
                {selectedHub ? `${selectedHub.marca} · ${selectedHub.nombre}` : "—"}
              </span>
              {" · "}Sube el bill quincenal (ZIP) tal cual lo manda Cainiao.
            </p>
          </header>

          {!selectedHub ? (
            <div className="px-4 py-6 border-l-2 border-destructive bg-destructive/10 text-destructive text-xs rounded-r">
              Selecciona un hub en la barra superior para empezar.
            </div>
          ) : (
            <>
              <section className="animate-fade-up">
                {!file ? (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
                    onClick={() => inputRef.current?.click()}
                    className={`group relative border-2 border-dashed transition-colors p-14 flex flex-col items-center justify-center rounded-lg cursor-pointer ${
                      dragOver ? "border-electric bg-electric/[0.04]" : "border-border hover:border-electric/50 hover:bg-accent/40"
                    }`}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".zip"
                      className="sr-only"
                      onChange={(e) => handleFile(e.target.files?.[0])}
                    />
                    <div className="size-14 bg-muted rounded-md flex items-center justify-center mb-4">
                      <Upload className="size-6 text-electric" strokeWidth={1.75} />
                    </div>
                    <h3 className="text-lg font-semibold mb-1.5 text-foreground">Cargar Consolidated_Bill (.zip)</h3>
                    <p className="text-muted-foreground text-xs">Arrastra o haz click para seleccionar</p>
                  </div>
                ) : (
                  <Card className="shadow-none">
                    <CardContent className="flex items-center gap-4 py-4">
                      <div className="size-10 bg-electric/10 border border-electric/30 rounded flex items-center justify-center shrink-0">
                        <FileSpreadsheet className="size-5 text-electric" strokeWidth={2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-foreground truncate">{file.name}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {formatSize(file.size)} · Listo para procesar
                        </div>
                      </div>
                      <Button variant="ghost" size="icon-sm" onClick={clearFile} disabled={processing} aria-label="Quitar archivo">
                        <X className="size-4" />
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {file && (
                  <div className="mt-4 flex justify-end">
                    <Button onClick={() => void process()} disabled={processing} className="gap-2">
                      {processing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                      {processing
                        ? progress
                          ? `Subiendo lote ${progress.done}/${progress.total}…`
                          : "Procesando…"
                        : "Procesar y guardar"}
                    </Button>
                  </div>
                )}

                {error && (
                  <div className="mt-4 px-4 py-3 border-l-2 border-destructive bg-destructive/10 text-destructive text-sm rounded-r flex items-start gap-2">
                    <AlertCircle className="size-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {result && (
                  <Card className="shadow-none mt-4">
                    <CardHeader>
                      <CardTitle className="text-sm font-semibold">Resumen de la subida</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Filas</p>
                        <p className="font-semibold text-xl tabular-nums">{result.totalFilas}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Importe total</p>
                        <p className="font-semibold text-xl tabular-nums">{result.totalImporte.toFixed(2)} €</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Periodo detectado</p>
                        <p className="font-semibold text-sm">
                          {result.periodoDesde ?? "—"} → {result.periodoHasta ?? "—"}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </section>

              <section className="space-y-3">
                <h2 className="text-base font-semibold tracking-tight text-foreground">Subidas anteriores</h2>
                {loadingHistory ? (
                  <p className="text-muted-foreground text-xs">Cargando…</p>
                ) : history.length === 0 ? (
                  <Card className="shadow-none">
                    <CardContent className="py-6 text-sm text-muted-foreground">
                      Todavía no subiste ningún bill de Cainiao para este hub.
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="shadow-none overflow-hidden">
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted">
                              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Archivo</th>
                              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Periodo</th>
                              <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Filas</th>
                              <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Importe</th>
                              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Subido</th>
                              <th className="px-4 py-2.5 w-16" />
                            </tr>
                          </thead>
                          <tbody>
                            {history.map((u) => (
                              <tr key={u.id} className="border-t border-border">
                                <td className="px-4 py-2 text-foreground truncate max-w-[220px]" title={u.filename}>{u.filename}</td>
                                <td className="px-4 py-2 text-foreground whitespace-nowrap">
                                  {u.periodo_desde ?? "—"} → {u.periodo_hasta ?? "—"}
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums text-foreground">{u.total_filas ?? "—"}</td>
                                <td className="px-4 py-2 text-right tabular-nums text-foreground">
                                  {u.total_importe != null ? `${Number(u.total_importe).toFixed(2)} €` : "—"}
                                </td>
                                <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                                  {new Date(u.uploaded_at).toLocaleString("es-ES")}
                                </td>
                                <td className="px-4 py-2">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => void deleteUpload(u)}
                                    disabled={deletingId === u.id}
                                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    aria-label="Eliminar"
                                  >
                                    {deletingId === u.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
