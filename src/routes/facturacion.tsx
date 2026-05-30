import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  Upload,
  X,
  Check,
  Loader2,
  ArrowDown,
  Sparkles,
  Save,
  Eye,
  AlertCircle,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/facturacion")({
  component: () => (
    <RequireAuth path="/facturacion">
      <FacturacionPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Facturación" },
      {
        name: "description",
        content:
          "Cruza tu ePOD con la factura de Cainiao y detecta paquetes no pagados.",
      },
    ],
  }),
});

type Row = {
  lp: string;
  waybill: string;
  driver: string;
  fecha: string;
  cp: string;
  tipo: string;
};

type AnalysisResult = {
  totalEpod: number;
  pagados: number;
  noPagados: number;
  importeEstimado: number;
  mediaBill: number;
  totalBill: number;
  unpaidRows: Row[];
  paidRows: Row[];
};

type FacturaHistory = {
  id: string;
  filename: string | null;
  fecha_factura: string | null;
  total_paquetes: number;
  no_pagados: number;
  importe_estimado_no_cobrado: number;
  created_at: string;
};

type DetalleRow = {
  lp_no: string;
  driver: string | null;
  fecha: string | null;
  cp: string | null;
  tipo: string | null;
  pagado: boolean;
};

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
function normalizeKey(k: string) {
  return k.toLowerCase().replace(/[\s._-]+/g, "");
}
function pickField(row: Record<string, unknown>, candidates: string[]): string {
  const map = new Map<string, string>();
  for (const k of Object.keys(row)) map.set(normalizeKey(k), k);
  for (const c of candidates) {
    const key = map.get(normalizeKey(c));
    if (key && row[key] != null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }
  return "";
}
function hasField(row: Record<string, unknown>, candidates: string[]): boolean {
  const set = new Set(Object.keys(row).map(normalizeKey));
  return candidates.some((c) => set.has(normalizeKey(c)));
}
function stripQuote(s: string) {
  return s.replace(/^['"`]/, "").trim();
}

function FacturacionPage() {
  const { selectedHub, user } = useAuth();
  const [epod, setEpod] = useState<File | null>(null);
  const [factura, setFactura] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<FacturaHistory[]>([]);
  const [detalle, setDetalle] = useState<{ id: string; rows: DetalleRow[] } | null>(null);
  const epodRef = useRef<HTMLInputElement>(null);
  const facturaRef = useRef<HTMLInputElement>(null);

  const loadHistory = async () => {
    if (!selectedHub) return;
    const { data } = await supabase
      .from("facturas_cainiao")
      .select(
        "id, filename, fecha_factura, total_paquetes, no_pagados, importe_estimado_no_cobrado, created_at",
      )
      .eq("hub_id", selectedHub.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setHistory((data ?? []) as FacturaHistory[]);
  };

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHub?.id]);

  const reset = () => {
    setResult(null);
    setError(null);
  };

  const handleEpod = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) {
      setError("ePOD debe ser un archivo Excel (.xlsx)");
      return;
    }
    reset();
    setEpod(f);
  };
  const handleFactura = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) {
      setError("Factura debe ser un archivo .csv");
      return;
    }
    reset();
    setFactura(f);
  };

  const analizar = async () => {
    if (!epod || !factura) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const [epodBuf, facturaBuf] = await Promise.all([
        epod.arrayBuffer(),
        factura.arrayBuffer(),
      ]);
      const epodWb = XLSX.read(epodBuf, { type: "array" });
      const epodSheet = epodWb.Sheets[epodWb.SheetNames[0]];
      const epodRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        epodSheet,
        { defval: "" },
      );

      if (epodRows.length === 0) {
        throw new Error("El archivo ePOD está vacío");
      }
      if (!hasField(epodRows[0], ["LP No.", "LPNo", "LP No"])) {
        throw new Error("No se encontró la columna LP No. en el ePOD");
      }

      const facturaWb = XLSX.read(facturaBuf, { type: "array", raw: true });
      const facturaSheet = facturaWb.Sheets[facturaWb.SheetNames[0]];
      const facturaRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        facturaSheet,
        { defval: "" },
      );
      if (facturaRows.length === 0) {
        throw new Error("El archivo de factura está vacío");
      }
      if (
        !hasField(facturaRows[0], [
          "Logistics Treasure Order Number",
          "LogisticsTreasureOrderNumber",
        ])
      ) {
        throw new Error("Formato de factura Cainiao no reconocido");
      }

      const facturaSet = new Set<string>();
      let totalBill = 0;
      let billCount = 0;
      for (const row of facturaRows) {
        const lp = stripQuote(
          pickField(row, [
            "Logistics Treasure Order Number",
            "LogisticsTreasureOrderNumber",
          ]),
        );
        if (lp) facturaSet.add(lp);
        const billRaw = pickField(row, ["Bill Amount", "BillAmount"]);
        const billNum = parseFloat(stripQuote(billRaw).replace(",", "."));
        if (!Number.isNaN(billNum)) {
          totalBill += billNum;
          billCount += 1;
        }
      }
      const mediaBill = billCount > 0 ? totalBill / billCount : 0;

      const unpaidRows: Row[] = [];
      const paidRows: Row[] = [];
      for (const row of epodRows) {
        const lp = stripQuote(pickField(row, ["LP No.", "LPNo", "LP No"]));
        if (!lp) continue;
        const r: Row = {
          lp,
          waybill: pickField(row, ["Waybill", "Waybill No", "WaybillNo"]),
          driver: pickField(row, [
            "Repartidor",
            "Driver",
            "Driver Name",
            "AOName",
            "AO Name",
          ]),
          fecha: pickField(row, [
            "Fecha",
            "Date",
            "Delivery Date",
            "Sign Time",
            "SignTime",
          ]),
          cp: pickField(row, ["CP", "Postcode", "Postal Code", "Zip", "ZipCode"]),
          tipo: pickField(row, ["Tipo", "Type", "Status", "Sign Type"]),
        };
        if (facturaSet.has(lp)) paidRows.push(r);
        else unpaidRows.push(r);
      }
      unpaidRows.sort((a, b) => a.driver.localeCompare(b.driver));
      paidRows.sort((a, b) => a.driver.localeCompare(b.driver));

      setResult({
        totalEpod: unpaidRows.length + paidRows.length,
        pagados: paidRows.length,
        noPagados: unpaidRows.length,
        importeEstimado: unpaidRows.length * mediaBill,
        mediaBill,
        totalBill,
        unpaidRows,
        paidRows,
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo analizar los archivos",
      );
    } finally {
      setLoading(false);
    }
  };

  const descargarExcel = () => {
    if (!result) return;
    const wb = XLSX.utils.book_new();
    const toSheet = (rows: Row[]) =>
      XLSX.utils.json_to_sheet(
        rows.map((r) => ({
          "LP No.": r.lp,
          Waybill: r.waybill,
          Driver: r.driver,
          Fecha: r.fecha,
          CP: r.cp,
          Tipo: r.tipo,
        })),
      );
    XLSX.utils.book_append_sheet(wb, toSheet(result.unpaidRows), "No Pagados");
    XLSX.utils.book_append_sheet(wb, toSheet(result.paidRows), "Pagados");
    XLSX.writeFile(
      wb,
      `Menssajero_Conciliacion_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  const guardar = async () => {
    if (!result || !selectedHub) return;
    setSaving(true);
    try {
      const { data: fact, error: fErr } = await supabase
        .from("facturas_cainiao")
        .insert({
          hub_id: selectedHub.id,
          user_id: user?.id ?? null,
          filename: factura?.name ?? null,
          fecha_factura: new Date().toISOString().slice(0, 10),
          total_paquetes: result.totalEpod,
          pagados: result.pagados,
          no_pagados: result.noPagados,
          importe_total: Number(result.totalBill.toFixed(2)),
          importe_estimado_no_cobrado: Number(result.importeEstimado.toFixed(2)),
        })
        .select("id")
        .single();
      if (fErr) throw fErr;

      const toIso = (s: string) => {
        if (!s) return null;
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      };
      const lines = [
        ...result.unpaidRows.map((r) => ({ ...r, pagado: false })),
        ...result.paidRows.map((r) => ({ ...r, pagado: true })),
      ].map((r) => ({
        hub_id: selectedHub.id,
        factura_id: fact.id,
        lp_no: r.lp,
        waybill: r.waybill || null,
        driver: r.driver || null,
        fecha: toIso(r.fecha),
        cp: r.cp || null,
        tipo: r.tipo || null,
        pagado: r.pagado,
        importe: r.pagado ? Number(result.mediaBill.toFixed(2)) : 0,
      }));
      // Chunked insert
      const chunk = 500;
      for (let i = 0; i < lines.length; i += chunk) {
        const { error: cErr } = await supabase
          .from("conciliacion")
          .insert(lines.slice(i, i + chunk));
        if (cErr) throw cErr;
      }
      toast.success("Análisis guardado");
      await loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const verDetalle = async (id: string) => {
    const { data, error } = await supabase
      .from("conciliacion")
      .select("lp_no, driver, fecha, cp, tipo, pagado")
      .eq("factura_id", id)
      .order("pagado", { ascending: true });
    if (error) {
      toast.error(error.message);
      return;
    }
    setDetalle({ id, rows: (data ?? []) as DetalleRow[] });
  };

  const descargarHistorico = async (h: FacturaHistory) => {
    const { data, error } = await supabase
      .from("conciliacion")
      .select("lp_no, waybill, driver, fecha, cp, tipo, pagado")
      .eq("factura_id", h.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    const rows = (data ?? []) as Array<{
      lp_no: string;
      waybill: string | null;
      driver: string | null;
      fecha: string | null;
      cp: string | null;
      tipo: string | null;
      pagado: boolean;
    }>;
    const wb = XLSX.utils.book_new();
    const map = (filter: boolean) =>
      XLSX.utils.json_to_sheet(
        rows
          .filter((r) => r.pagado === filter)
          .map((r) => ({
            "LP No.": r.lp_no,
            Waybill: r.waybill ?? "",
            Driver: r.driver ?? "",
            Fecha: r.fecha ?? "",
            CP: r.cp ?? "",
            Tipo: r.tipo ?? "",
          })),
      );
    XLSX.utils.book_append_sheet(wb, map(false), "No Pagados");
    XLSX.utils.book_append_sheet(wb, map(true), "Pagados");
    XLSX.writeFile(
      wb,
      `Menssajero_Conciliacion_${(h.created_at ?? "").slice(0, 10)}.xlsx`,
    );
  };

  const canAnalyze = !!epod && !!factura && !loading;
  const canSave = !!result && !!selectedHub && !saving;

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Facturación" />

      <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-[1fr_300px] gap-10">
          {/* MAIN */}
          <div className="min-w-0">
            <header className="mb-12 animate-fade-up">
              <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4 flex items-center gap-2">
                <span className="size-1 bg-electric rounded-full" />
                Conciliación · Cainiao vs ePOD
              </div>
              <h1 className="text-4xl lg:text-6xl font-syne font-extrabold leading-[0.95] text-ink tracking-tighter uppercase">
                Control de
                <br />
                <span className="font-playfair italic font-medium text-electric normal-case tracking-normal">
                  facturación
                </span>
              </h1>
              <p className="mt-6 text-muted-text text-pretty max-w-[52ch] text-[15px] leading-relaxed">
                Cruza tu ePOD con la factura de Cainiao y detecta los paquetes
                que no te están pagando.
                {selectedHub && (
                  <span className="block mt-1 font-mono text-[11px] tracking-widest uppercase text-muted-text/80">
                    Hub: {selectedHub.marca} · {selectedHub.nombre}
                  </span>
                )}
              </p>
            </header>

            <section
              className="grid md:grid-cols-2 gap-4 mb-6 animate-fade-up"
              style={{ animationDelay: "60ms" }}
            >
              <UploadZone
                label="Archivo 1 · ePOD"
                hint=".xlsx"
                accept=".xlsx,.xls"
                file={epod}
                onFile={handleEpod}
                onClear={() => {
                  setEpod(null);
                  reset();
                  if (epodRef.current) epodRef.current.value = "";
                }}
                inputRef={epodRef}
              />
              <UploadZone
                label="Archivo 2 · Factura Cainiao"
                hint=".csv"
                accept=".csv"
                file={factura}
                onFile={handleFactura}
                onClear={() => {
                  setFactura(null);
                  reset();
                  if (facturaRef.current) facturaRef.current.value = "";
                }}
                inputRef={facturaRef}
              />
            </section>

            {error && (
              <div className="mb-6 px-4 py-2.5 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs rounded-r flex items-center gap-2">
                <AlertCircle className="size-3.5" />
                {error}
              </div>
            )}

            <section
              className="mb-12 animate-fade-up"
              style={{ animationDelay: "120ms" }}
            >
              <button
                onClick={analizar}
                disabled={!canAnalyze}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold font-syne tracking-tight rounded-md bg-electric text-white hover:brightness-110 transition-all disabled:bg-surface-2 disabled:text-muted-text disabled:cursor-not-allowed disabled:border disabled:border-hairline"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {loading ? "Analizando" : "Analizar facturación"}
              </button>
            </section>

            {result && (
              <section className="animate-fade-up space-y-8 mb-16">
                <div>
                  <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4">
                    Resumen
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden">
                    <KpiCard label="Total ePOD" value={result.totalEpod.toLocaleString("es-ES")} />
                    <KpiCard label="Pagados" value={result.pagados.toLocaleString("es-ES")} tone="success" />
                    <KpiCard label="No pagados" value={result.noPagados.toLocaleString("es-ES")} tone="danger" />
                    <KpiCard
                      label="Importe estimado no cobrado"
                      value={`${result.importeEstimado.toLocaleString("es-ES", { maximumFractionDigits: 2 })} €`}
                      tone="amber"
                    />
                  </div>
                  <div className="mt-2 font-mono text-[10px] text-muted-text/70 tracking-widest uppercase">
                    Media Bill Amount: {result.mediaBill.toFixed(2)} €
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={descargarExcel}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold font-syne tracking-tight rounded-md bg-ink text-white hover:bg-ink/90 transition-all"
                  >
                    <ArrowDown className="size-3.5" />
                    Descargar Excel completo
                  </button>
                  <button
                    onClick={guardar}
                    disabled={!canSave}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold font-syne tracking-tight rounded-md border border-hairline bg-surface hover:bg-surface-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                    Guardar análisis
                  </button>
                </div>

                <div>
                  <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4">
                    Paquetes no pagados · {result.noPagados}
                  </div>

                  {result.unpaidRows.length === 0 ? (
                    <div className="p-8 text-center border border-hairline rounded-lg bg-surface">
                      <Check className="size-6 text-success mx-auto mb-2" />
                      <p className="font-syne text-ink text-sm">
                        ✓ Todos los paquetes están facturados
                      </p>
                    </div>
                  ) : (
                    <div className="border border-hairline rounded-lg overflow-hidden bg-surface">
                      <div className="overflow-x-auto max-h-[480px]">
                        <table className="w-full text-[13px]">
                          <thead className="bg-surface-2 sticky top-0">
                            <tr className="text-left">
                              <Th>LP No.</Th>
                              <Th>Driver</Th>
                              <Th>Fecha</Th>
                              <Th>CP</Th>
                              <Th>Tipo</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.unpaidRows.map((r, i) => (
                              <tr key={`${r.lp}-${i}`} className="border-t border-hairline hover:bg-ink/[0.02]">
                                <Td mono className="text-danger">{r.lp}</Td>
                                <Td>{r.driver || "—"}</Td>
                                <Td mono>{r.fecha || "—"}</Td>
                                <Td mono>{r.cp || "—"}</Td>
                                <Td><TipoBadge tipo={r.tipo} /></Td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* HISTORY */}
            <section className="mb-12">
              <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4">
                Análisis anteriores
              </div>
              {history.length === 0 ? (
                <div className="p-6 text-center border border-dashed border-hairline rounded-lg bg-surface text-muted-text text-sm">
                  No hay análisis guardados para este hub.
                </div>
              ) : (
                <div className="border border-hairline rounded-lg overflow-hidden bg-surface">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="bg-surface-2">
                        <tr className="text-left">
                          <Th>Fecha</Th>
                          <Th>Archivo factura</Th>
                          <Th>Paquetes</Th>
                          <Th>No pagados</Th>
                          <Th>Estimado</Th>
                          <Th> </Th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((h) => (
                          <tr key={h.id} className="border-t border-hairline hover:bg-ink/[0.02]">
                            <Td mono>{new Date(h.created_at).toLocaleDateString("es-ES")}</Td>
                            <Td>{h.filename ?? "—"}</Td>
                            <Td mono>{h.total_paquetes}</Td>
                            <Td mono className="text-danger">{h.no_pagados}</Td>
                            <Td mono>{Number(h.importe_estimado_no_cobrado).toLocaleString("es-ES", { maximumFractionDigits: 2 })} €</Td>
                            <Td>
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => verDetalle(h.id)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono uppercase tracking-widest rounded border border-hairline hover:bg-surface-2"
                                >
                                  <Eye className="size-3" /> Ver
                                </button>
                                <button
                                  onClick={() => void descargarHistorico(h)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono uppercase tracking-widest rounded border border-hairline hover:bg-surface-2"
                                >
                                  <ArrowDown className="size-3" />
                                </button>
                              </div>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* RIGHT PANEL */}
          <aside className="hidden lg:block space-y-4">
            <InfoCard title="Cómo funciona">
              <Step n="01" text="Sube tu ePOD (.xlsx) del periodo" />
              <Step n="02" text="Sube la factura de Cainiao (.csv)" />
              <Step n="03" text="Analiza, descarga y guarda" />
            </InfoCard>
            <InfoCard title="Qué detecta">
              <Bullet color="danger">NO PAGADOS · entregados sin factura</Bullet>
              <Bullet color="success">PAGADOS · correctamente incluidos</Bullet>
              <Bullet color="amber">REZAGADOS · pueden aparecer en el siguiente ciclo</Bullet>
            </InfoCard>
            <InfoCard title="Campo de cruce">
              <p className="text-xs text-muted-text leading-relaxed">
                <span className="font-mono text-ink">LP No.</span> del ePOD
                <br />vs<br />
                <span className="font-mono text-ink">Logistics Treasure Order Number</span> del CSV
              </p>
            </InfoCard>
          </aside>
        </div>
      </div>

      {/* DETAIL SIDE PANEL */}
      {detalle && (
        <div className="fixed inset-0 z-50 flex">
          <button
            className="flex-1 bg-ink/30 backdrop-blur-sm"
            onClick={() => setDetalle(null)}
            aria-label="Cerrar"
          />
          <div className="w-full max-w-xl bg-background border-l border-hairline overflow-y-auto">
            <div className="p-6 border-b border-hairline flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase">Detalle</div>
                <div className="font-syne text-lg text-ink">{detalle.rows.length} líneas</div>
              </div>
              <button onClick={() => setDetalle(null)} className="size-8 rounded hover:bg-surface-2 grid place-items-center">
                <X className="size-4" />
              </button>
            </div>
            <table className="w-full text-[12px]">
              <thead className="bg-surface-2 sticky top-0">
                <tr className="text-left">
                  <Th>LP No.</Th>
                  <Th>Driver</Th>
                  <Th>Tipo</Th>
                  <Th>Pagado</Th>
                </tr>
              </thead>
              <tbody>
                {detalle.rows.map((r, i) => (
                  <tr key={`${r.lp_no}-${i}`} className="border-t border-hairline">
                    <Td mono className={r.pagado ? "" : "text-danger"}>{r.lp_no}</Td>
                    <Td>{r.driver ?? "—"}</Td>
                    <Td><TipoBadge tipo={r.tipo ?? ""} /></Td>
                    <Td>
                      {r.pagado ? (
                        <span className="text-success font-mono text-[10px] uppercase tracking-widest">Sí</span>
                      ) : (
                        <span className="text-danger font-mono text-[10px] uppercase tracking-widest">No</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadZone({
  label, hint, accept, file, onFile, onClear, inputRef,
}: {
  label: string; hint: string; accept: string;
  file: File | null;
  onFile: (f: File | undefined) => void;
  onClear: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [dragOver, setDragOver] = useState(false);
  if (file) {
    return (
      <div className="flex items-center gap-4 p-5 bg-surface border-2 border-success/60 rounded-lg">
        <div className="size-10 bg-success/10 border border-success/30 rounded flex items-center justify-center shrink-0">
          <Check className="size-4 text-success" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase mb-0.5">{label}</div>
          <div className="font-mono text-sm text-ink truncate">{file.name}</div>
          <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase mt-0.5">{formatSize(file.size)}</div>
        </div>
        <button onClick={onClear} className="size-8 rounded grid place-items-center text-muted-text hover:text-ink hover:bg-ink/5 transition-colors" aria-label="Quitar archivo">
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0]); }}
      onClick={() => inputRef.current?.click()}
      className={`group relative border-2 border-dashed transition-colors p-8 flex flex-col items-center justify-center rounded-lg cursor-pointer ${
        dragOver ? "border-electric bg-electric/[0.04]" : "border-surface-3 hover:border-electric/50 hover:bg-ink/[0.02]"
      }`}
    >
      <input ref={inputRef} type="file" accept={accept} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? undefined)} />
      <div className="size-10 bg-surface-2 rounded-md flex items-center justify-center mb-3 ring-1 ring-hairline">
        <Upload className="size-4 text-electric" strokeWidth={1.75} />
      </div>
      <h3 className="font-syne text-base mb-1 text-ink">{label}</h3>
      <p className="text-muted-text text-[10px] font-mono tracking-widest uppercase">{hint} · arrastra o haz click</p>
    </div>
  );
}

function KpiCard({
  label, value, tone = "default",
}: { label: string; value: string; tone?: "default" | "success" | "danger" | "electric" | "amber" }) {
  const color =
    tone === "success" ? "text-success"
    : tone === "danger" ? "text-danger"
    : tone === "electric" ? "text-electric"
    : tone === "amber" ? "text-[#a16207]"
    : "text-ink";
  return (
    <div className="bg-background p-6">
      <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-muted-text mb-3">{label}</div>
      <div className={`font-syne font-extrabold text-3xl tracking-tighter ${color}`}>{value}</div>
    </div>
  );
}

function TipoBadge({ tipo }: { tipo: string }) {
  if (!tipo) return <span className="text-muted-text">—</span>;
  const t = tipo.toUpperCase();
  const isPudo = t.includes("PUDO");
  const isDoor = t.includes("DOOR") || t.includes("TO_DOOR");
  const cls = isPudo
    ? "bg-success/10 text-success border-success/30"
    : isDoor
    ? "bg-electric/10 text-electric border-electric/30"
    : "bg-surface-2 text-muted-text border-hairline";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded border font-mono text-[10px] uppercase tracking-widest ${cls}`}>
      {tipo}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-mono text-[10px] tracking-widest uppercase text-muted-text font-medium">{children}</th>;
}
function Td({ children, mono, className = "" }: { children: React.ReactNode; mono?: boolean; className?: string }) {
  return <td className={`px-4 py-2.5 text-ink ${mono ? "font-mono text-[12px]" : ""} ${className}`}>{children}</td>;
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-hairline rounded-lg bg-surface p-5">
      <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-3">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Step({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="font-mono text-[10px] text-electric tracking-widest">{n}</span>
      <span className="text-xs text-ink leading-relaxed">{text}</span>
    </div>
  );
}
function Bullet({ color, children }: { color: "danger" | "success" | "amber"; children: React.ReactNode }) {
  const c = color === "danger" ? "bg-danger" : color === "success" ? "bg-success" : "bg-[#a16207]";
  return (
    <div className="flex items-start gap-2">
      <span className={`size-1.5 rounded-full mt-1.5 shrink-0 ${c}`} />
      <span className="text-xs text-muted-text leading-relaxed">{children}</span>
    </div>
  );
}
