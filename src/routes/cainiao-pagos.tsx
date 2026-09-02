import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import Papa from "papaparse";
import XLSXStyle from "xlsx-js-style";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, X, Loader2, AlertCircle, Trash2, Download } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusIndicator } from "@/components/indicator";

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
        <div className="max-w-5xl mx-auto space-y-10">
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
            <Tabs defaultValue="subida" className="space-y-6">
              <TabsList>
                <TabsTrigger value="subida">Subir archivo</TabsTrigger>
                <TabsTrigger value="matching">Matching</TabsTrigger>
                <TabsTrigger value="compensaciones">Compensaciones</TabsTrigger>
              </TabsList>

              <TabsContent value="subida" className="space-y-10">
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
              </TabsContent>

              <TabsContent value="matching">
                <MatchingSection hubId={selectedHub.id} />
              </TabsContent>

              <TabsContent value="compensaciones">
                <CompensacionesSection hubId={selectedHub.id} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PUNTO 2: MATCHING CONTRA entregas
// ============================================================

type UploadOption = {
  id: string;
  filename: string;
  periodo_desde: string | null;
  periodo_hasta: string | null;
};

type MatchCategoria = "pagado" | "sin_pagar" | "sin_entregar";

const MATCH_CATEGORIA_LABEL: Record<MatchCategoria, string> = {
  pagado: "Pagado y coincide",
  sin_pagar: "Entregado sin pagar",
  sin_entregar: "Pagado sin entregar registrado",
};

const MATCH_CATEGORIA_DOT: Record<MatchCategoria, "emerald" | "rose" | "amber"> = {
  pagado: "emerald",
  sin_pagar: "rose",
  sin_entregar: "amber",
};

type MatchRow = {
  lp_no: string;
  categoria: MatchCategoria;
  cainiao_importe: number | null;
  entregas_cp: string | null;
  entregas_direccion: string | null;
  entregas_driver: string | null;
  entregas_fecha: string | null;
};

const PAGE_SIZE = 1000;

async function fetchCainiaoNetos(uploadId: string): Promise<Map<string, number>> {
  const { count, error: countErr } = await supabase
    .from("cainiao_bill_lineas")
    .select("id", { count: "exact", head: true })
    .eq("upload_id", uploadId);
  if (countErr) throw countErr;
  const total = count ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => {
      const from = i * PAGE_SIZE;
      return supabase
        .from("cainiao_bill_lineas")
        .select("lp_no, bill_amount")
        .eq("upload_id", uploadId)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
    }),
  );
  const netos = new Map<string, number>();
  let sinLp = 0;
  for (const { data, error: qErr } of pages) {
    if (qErr) throw qErr;
    for (const r of data ?? []) {
      if (!r.lp_no) { sinLp++; continue; }
      netos.set(r.lp_no, (netos.get(r.lp_no) ?? 0) + Number(r.bill_amount));
    }
  }
  if (sinLp > 0) {
    toast.info(`${sinLp} línea(s) de Cainiao sin LP real (ajustes generales del hub) — no entran en el matching por paquete.`);
  }
  return netos;
}

async function fetchEntregasEntregadas(
  hubId: string,
  desde: string,
  hasta: string,
): Promise<Map<string, { cp: string | null; direccion: string | null; driver: string | null; fecha: string | null }>> {
  const { count, error: countErr } = await supabase
    .from("entregas")
    .select("id", { count: "exact", head: true })
    .eq("hub_id", hubId)
    .eq("estado", "Entregado")
    .gte("fecha", desde)
    .lte("fecha", hasta);
  if (countErr) throw countErr;
  const total = count ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => {
      const from = i * PAGE_SIZE;
      return supabase
        .from("entregas")
        .select("lp_no, cp, direccion, driver, fecha")
        .eq("hub_id", hubId)
        .eq("estado", "Entregado")
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
    }),
  );
  const map = new Map<string, { cp: string | null; direccion: string | null; driver: string | null; fecha: string | null }>();
  for (const { data, error: qErr } of pages) {
    if (qErr) throw qErr;
    for (const r of data ?? []) {
      map.set(r.lp_no, { cp: r.cp, direccion: r.direccion, driver: r.driver, fecha: r.fecha });
    }
  }
  return map;
}

function exportMatchingXlsx(rows: MatchRow[], hubMarca: string, periodo: string) {
  const headers = ["LP No.", "Categoría", "Importe Cainiao (€)", "CP", "Dirección", "Driver", "Fecha entrega"];
  const aoa: (string | number)[][] = [headers];
  for (const r of rows) {
    aoa.push([
      r.lp_no,
      MATCH_CATEGORIA_LABEL[r.categoria],
      r.cainiao_importe != null ? Number(r.cainiao_importe.toFixed(2)) : "",
      r.entregas_cp ?? "",
      r.entregas_direccion ?? "",
      r.entregas_driver ?? "",
      r.entregas_fecha ?? "",
    ]);
  }
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
  const headerStyle = {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "111111" } },
  };
  const range = XLSXStyle.utils.decode_range(ws["!ref"] as string);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSXStyle.utils.encode_cell({ r: 0, c })];
    if (cell) cell.s = headerStyle;
  }
  ws["!cols"] = [{ wch: 22 }, { wch: 26 }, { wch: 16 }, { wch: 10 }, { wch: 32 }, { wch: 20 }, { wch: 14 }];
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, "Matching Cainiao");
  const buf = XLSXStyle.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Matching_Cainiao_${hubMarca.replace(/[^a-z0-9]+/gi, "_")}_${periodo}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function MatchingSection({ hubId }: { hubId: string }) {
  const { selectedHub } = useAuth();
  const [uploads, setUploads] = useState<UploadOption[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string>("");
  const [loadingUploads, setLoadingUploads] = useState(true);
  const [matching, setMatching] = useState(false);
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [filtro, setFiltro] = useState<"todas" | MatchCategoria>("todas");
  const [ranOnce, setRanOnce] = useState(false);

  useEffect(() => {
    const loadUploads = async () => {
      setLoadingUploads(true);
      const { data, error } = await supabase
        .from("cainiao_bill_uploads")
        .select("id, filename, periodo_desde, periodo_hasta")
        .eq("hub_id", hubId)
        .order("uploaded_at", { ascending: false });
      if (error) toast.error(error.message);
      const list = (data ?? []) as UploadOption[];
      setUploads(list);
      setSelectedUploadId((prev) => (list.some((u) => u.id === prev) ? prev : list[0]?.id ?? ""));
      setLoadingUploads(false);
    };
    void loadUploads();
  }, [hubId]);

  const runMatching = async () => {
    const upload = uploads.find((u) => u.id === selectedUploadId);
    if (!upload) return;
    if (!upload.periodo_desde || !upload.periodo_hasta) {
      toast.error("Esta subida no tiene periodo detectado — no se puede hacer matching.");
      return;
    }
    setMatching(true);
    setRanOnce(true);
    try {
      const [netos, entregasMap] = await Promise.all([
        fetchCainiaoNetos(upload.id),
        fetchEntregasEntregadas(hubId, upload.periodo_desde, upload.periodo_hasta),
      ]);
      const lpSet = new Set<string>([...netos.keys(), ...entregasMap.keys()]);
      const out: MatchRow[] = [];
      for (const lp of lpSet) {
        const importe = netos.get(lp) ?? null;
        const ent = entregasMap.get(lp) ?? null;
        const categoria: MatchCategoria = importe != null && ent ? "pagado" : ent ? "sin_pagar" : "sin_entregar";
        out.push({
          lp_no: lp,
          categoria,
          cainiao_importe: importe,
          entregas_cp: ent?.cp ?? null,
          entregas_direccion: ent?.direccion ?? null,
          entregas_driver: ent?.driver ?? null,
          entregas_fecha: ent?.fecha ?? null,
        });
      }
      out.sort((a, b) => a.lp_no.localeCompare(b.lp_no));
      setRows(out);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error haciendo el matching");
    } finally {
      setMatching(false);
    }
  };

  const counts = {
    pagado: rows.filter((r) => r.categoria === "pagado"),
    sin_pagar: rows.filter((r) => r.categoria === "sin_pagar"),
    sin_entregar: rows.filter((r) => r.categoria === "sin_entregar"),
  };
  const sum = (list: MatchRow[]) => list.reduce((acc, r) => acc + (r.cainiao_importe ?? 0), 0);

  const filtered = filtro === "todas" ? rows : rows.filter((r) => r.categoria === filtro);
  const selectedUpload = uploads.find((u) => u.id === selectedUploadId);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
            Subida a conciliar
          </span>
          <select
            value={selectedUploadId}
            onChange={(e) => setSelectedUploadId(e.target.value)}
            disabled={loadingUploads || uploads.length === 0}
            className="appearance-none pl-3 pr-8 py-2 text-sm bg-card border rounded-md text-foreground min-w-[320px]"
          >
            {uploads.length === 0 && <option value="">Sin subidas para este hub</option>}
            {uploads.map((u) => (
              <option key={u.id} value={u.id}>
                {u.filename} ({u.periodo_desde ?? "—"} → {u.periodo_hasta ?? "—"})
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => void runMatching()} disabled={matching || !selectedUploadId} className="gap-2">
          {matching ? <Loader2 className="size-4 animate-spin" /> : null}
          {matching ? "Cruzando…" : "Cruzar contra entregas"}
        </Button>
        {rows.length > 0 && selectedHub && selectedUpload && (
          <Button
            variant="outline"
            onClick={() => exportMatchingXlsx(filtered, selectedHub.marca, `${selectedUpload.periodo_desde}_${selectedUpload.periodo_hasta}`)}
            className="gap-2"
          >
            <Download className="size-3.5" /> Exportar Excel
          </Button>
        )}
      </div>

      {ranOnce && !matching && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(["pagado", "sin_pagar", "sin_entregar"] as MatchCategoria[]).map((cat) => (
              <Card key={cat} className="shadow-none">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 font-normal text-muted-foreground text-xs">
                    <StatusIndicator color={MATCH_CATEGORIA_DOT[cat]} pulse={false} />
                    {MATCH_CATEGORIA_LABEL[cat]}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-semibold text-2xl tabular-nums">{counts[cat].length}</p>
                  <p className="text-xs text-muted-foreground mt-1">{sum(counts[cat]).toFixed(2)} € (Cainiao)</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as typeof filtro)}
              className="appearance-none pl-3 pr-8 py-1.5 text-xs bg-card border rounded-md text-foreground"
            >
              <option value="todas">Todas las categorías ({rows.length})</option>
              {(["pagado", "sin_pagar", "sin_entregar"] as MatchCategoria[]).map((cat) => (
                <option key={cat} value={cat}>{MATCH_CATEGORIA_LABEL[cat]} ({counts[cat].length})</option>
              ))}
            </select>
          </div>

          <Card className="shadow-none overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted">
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">LP No.</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Categoría</th>
                      <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Importe Cainiao</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">CP</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Driver</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs">Sin filas para este filtro</td></tr>
                    ) : (
                      filtered.map((r) => (
                        <tr key={r.lp_no} className="border-t border-border">
                          <td className="px-4 py-2 text-foreground whitespace-nowrap">{r.lp_no}</td>
                          <td className="px-4 py-2">
                            <span className="inline-flex items-center gap-1.5 text-xs">
                              <StatusIndicator color={MATCH_CATEGORIA_DOT[r.categoria]} pulse={false} />
                              {MATCH_CATEGORIA_LABEL[r.categoria]}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-foreground">
                            {r.cainiao_importe != null ? `${r.cainiao_importe.toFixed(2)} €` : "—"}
                          </td>
                          <td className="px-4 py-2 text-foreground">{r.entregas_cp ?? "—"}</td>
                          <td className="px-4 py-2 text-foreground">{r.entregas_driver ?? "—"}</td>
                          <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{r.entregas_fecha ?? "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

// ============================================================
// PUNTO 3: COMPENSACIONES / PENALIZACIONES
// ============================================================

const BILL_ITEM_COMPENSACION = "货值赔付";

type CompensacionRow = {
  lp_no: string;
  bill_amount: number;
  billing_time: string | null;
  cp: string | null;
  direccion: string | null;
  driver: string | null;
  fuente: "entregas" | "epod_lineas" | null;
};

async function fetchCompensacionesCainiao(
  uploadId: string,
): Promise<{ lp_no: string; bill_amount: number; billing_time: string | null }[]> {
  const { count, error: countErr } = await supabase
    .from("cainiao_bill_lineas")
    .select("id", { count: "exact", head: true })
    .eq("upload_id", uploadId)
    .eq("bill_item", BILL_ITEM_COMPENSACION);
  if (countErr) throw countErr;
  const total = count ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => {
      const from = i * PAGE_SIZE;
      return supabase
        .from("cainiao_bill_lineas")
        .select("lp_no, bill_amount, billing_time")
        .eq("upload_id", uploadId)
        .eq("bill_item", BILL_ITEM_COMPENSACION)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
    }),
  );
  const out: { lp_no: string; bill_amount: number; billing_time: string | null }[] = [];
  for (const { data, error: qErr } of pages) {
    if (qErr) throw qErr;
    for (const r of data ?? []) {
      if (!r.lp_no) continue; // penalización sin LP real — no hay contra qué cruzar
      out.push({ lp_no: r.lp_no, bill_amount: Number(r.bill_amount), billing_time: r.billing_time });
    }
  }
  return out;
}

// Cruza cada compensación contra entregas primero (cualquier estado, no solo
// Entregado — una penalización puede corresponder a un paquete dañado o
// perdido que no llegó a "Entregado") y, si no aparece ahí, contra
// epod_lineas (el log crudo) como respaldo — mismo criterio pedido: "cruzada
// con entregas/epod_lineas".
async function crossReferenceCompensaciones(
  hubId: string,
  lineas: { lp_no: string; bill_amount: number; billing_time: string | null }[],
): Promise<CompensacionRow[]> {
  const lpNos = [...new Set(lineas.map((l) => l.lp_no))];
  const infoByLp = new Map<string, { cp: string | null; direccion: string | null; driver: string | null; fuente: "entregas" | "epod_lineas" }>();

  if (lpNos.length > 0) {
    const { data: entregasData, error: eErr } = await supabase
      .from("entregas")
      .select("lp_no, cp, direccion, driver")
      .eq("hub_id", hubId)
      .in("lp_no", lpNos);
    if (eErr) throw eErr;
    for (const r of entregasData ?? []) {
      infoByLp.set(r.lp_no, { cp: r.cp, direccion: r.direccion, driver: r.driver, fuente: "entregas" });
    }

    const faltantes = lpNos.filter((lp) => !infoByLp.has(lp));
    if (faltantes.length > 0) {
      const { data: epodData, error: pErr } = await supabase
        .from("epod_lineas")
        .select("lp_no, cp, direccion, driver")
        .eq("hub_id", hubId)
        .in("lp_no", faltantes);
      if (pErr) throw pErr;
      for (const r of epodData ?? []) {
        if (!infoByLp.has(r.lp_no)) {
          infoByLp.set(r.lp_no, { cp: r.cp, direccion: r.direccion, driver: r.driver, fuente: "epod_lineas" });
        }
      }
    }
  }

  return lineas.map((l) => {
    const info = infoByLp.get(l.lp_no);
    return {
      lp_no: l.lp_no,
      bill_amount: l.bill_amount,
      billing_time: l.billing_time,
      cp: info?.cp ?? null,
      direccion: info?.direccion ?? null,
      driver: info?.driver ?? null,
      fuente: info?.fuente ?? null,
    };
  });
}

function exportCompensacionesXlsx(rows: CompensacionRow[], hubMarca: string, periodo: string) {
  const headers = ["LP No.", "Importe (€)", "Fecha", "CP", "Dirección", "Driver", "Fuente del cruce"];
  const aoa: (string | number)[][] = [headers];
  for (const r of rows) {
    aoa.push([
      r.lp_no,
      Number(r.bill_amount.toFixed(2)),
      r.billing_time ? r.billing_time.slice(0, 10) : "",
      r.cp ?? "",
      r.direccion ?? "",
      r.driver ?? "",
      r.fuente === "entregas" ? "entregas" : r.fuente === "epod_lineas" ? "epod_lineas" : "sin cruce",
    ]);
  }
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
  const headerStyle = {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "B91C1C" } },
  };
  const range = XLSXStyle.utils.decode_range(ws["!ref"] as string);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSXStyle.utils.encode_cell({ r: 0, c })];
    if (cell) cell.s = headerStyle;
  }
  ws["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 32 }, { wch: 20 }, { wch: 14 }];
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, "Compensaciones Cainiao");
  const buf = XLSXStyle.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Compensaciones_Cainiao_${hubMarca.replace(/[^a-z0-9]+/gi, "_")}_${periodo}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function CompensacionesSection({ hubId }: { hubId: string }) {
  const { selectedHub } = useAuth();
  const [uploads, setUploads] = useState<UploadOption[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string>("");
  const [loadingUploads, setLoadingUploads] = useState(true);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CompensacionRow[]>([]);
  const [ranOnce, setRanOnce] = useState(false);

  useEffect(() => {
    const loadUploads = async () => {
      setLoadingUploads(true);
      const { data, error } = await supabase
        .from("cainiao_bill_uploads")
        .select("id, filename, periodo_desde, periodo_hasta")
        .eq("hub_id", hubId)
        .order("uploaded_at", { ascending: false });
      if (error) toast.error(error.message);
      const list = (data ?? []) as UploadOption[];
      setUploads(list);
      setSelectedUploadId((prev) => (list.some((u) => u.id === prev) ? prev : list[0]?.id ?? ""));
      setLoadingUploads(false);
    };
    void loadUploads();
  }, [hubId]);

  const run = async () => {
    if (!selectedUploadId) return;
    setLoading(true);
    setRanOnce(true);
    try {
      const lineas = await fetchCompensacionesCainiao(selectedUploadId);
      const cruzadas = await crossReferenceCompensaciones(hubId, lineas);
      cruzadas.sort((a, b) => (a.billing_time ?? "").localeCompare(b.billing_time ?? ""));
      setRows(cruzadas);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error cargando compensaciones");
    } finally {
      setLoading(false);
    }
  };

  const total = rows.reduce((acc, r) => acc + r.bill_amount, 0);
  const selectedUpload = uploads.find((u) => u.id === selectedUploadId);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
            Subida a revisar
          </span>
          <select
            value={selectedUploadId}
            onChange={(e) => setSelectedUploadId(e.target.value)}
            disabled={loadingUploads || uploads.length === 0}
            className="appearance-none pl-3 pr-8 py-2 text-sm bg-card border rounded-md text-foreground min-w-[320px]"
          >
            {uploads.length === 0 && <option value="">Sin subidas para este hub</option>}
            {uploads.map((u) => (
              <option key={u.id} value={u.id}>
                {u.filename} ({u.periodo_desde ?? "—"} → {u.periodo_hasta ?? "—"})
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => void run()} disabled={loading || !selectedUploadId} className="gap-2">
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {loading ? "Cargando…" : "Ver compensaciones"}
        </Button>
        {rows.length > 0 && selectedHub && selectedUpload && (
          <Button
            variant="outline"
            onClick={() => exportCompensacionesXlsx(rows, selectedHub.marca, `${selectedUpload.periodo_desde}_${selectedUpload.periodo_hasta}`)}
            className="gap-2"
          >
            <Download className="size-3.5" /> Exportar Excel
          </Button>
        )}
      </div>

      {ranOnce && !loading && (
        <>
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="font-normal text-muted-foreground text-xs">
                Total de compensaciones/penalizaciones del periodo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-semibold text-2xl tabular-nums">{total.toFixed(2)} €</p>
              <p className="text-xs text-muted-foreground mt-1">{rows.length} línea(s)</p>
            </CardContent>
          </Card>

          <Card className="shadow-none overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted">
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">LP No.</th>
                      <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Importe</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Fecha</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">CP</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Dirección</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Driver</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs">Sin compensaciones/penalizaciones en esta subida</td></tr>
                    ) : (
                      rows.map((r, i) => (
                        <tr key={`${r.lp_no}-${i}`} className="border-t border-border">
                          <td className="px-4 py-2 text-foreground whitespace-nowrap">{r.lp_no}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-destructive font-medium">{r.bill_amount.toFixed(2)} €</td>
                          <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{r.billing_time ? r.billing_time.slice(0, 10) : "—"}</td>
                          <td className="px-4 py-2 text-foreground">{r.cp ?? "—"}</td>
                          <td className="px-4 py-2 text-foreground max-w-[240px] truncate" title={r.direccion ?? ""}>{r.direccion ?? "—"}</td>
                          <td className="px-4 py-2 text-foreground">{r.driver ?? "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
