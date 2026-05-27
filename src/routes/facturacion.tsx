import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, X, Check, Loader2, ArrowDown, Sparkles } from "lucide-react";

export const Route = createFileRoute("/facturacion")({
  component: FacturacionPage,
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

type AnalysisResult = {
  totalEpod: number;
  pagados: number;
  noPagados: number;
  importeEstimado: number;
  mediaBill: number;
  rows: Array<{
    lp: string;
    repartidor: string;
    fecha: string;
    cp: string;
    tipo: string;
  }>;
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

function stripQuote(s: string) {
  return s.replace(/^['"`]/, "").trim();
}

function FacturacionPage() {
  const [epod, setEpod] = useState<File | null>(null);
  const [factura, setFactura] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const epodRef = useRef<HTMLInputElement>(null);
  const facturaRef = useRef<HTMLInputElement>(null);

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
      const epodRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(epodSheet, {
        defval: "",
      });

      const facturaWb = XLSX.read(facturaBuf, { type: "array", raw: true });
      const facturaSheet = facturaWb.Sheets[facturaWb.SheetNames[0]];
      const facturaRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        facturaSheet,
        { defval: "" },
      );

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

      const noPagadosRows: AnalysisResult["rows"] = [];
      let pagados = 0;
      let totalEpod = 0;
      for (const row of epodRows) {
        const lp = stripQuote(pickField(row, ["LP No.", "LPNo", "LP No"]));
        if (!lp) continue;
        totalEpod += 1;
        if (facturaSet.has(lp)) {
          pagados += 1;
        } else {
          noPagadosRows.push({
            lp,
            repartidor: pickField(row, [
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
            cp: pickField(row, [
              "CP",
              "Postcode",
              "Postal Code",
              "Zip",
              "ZipCode",
            ]),
            tipo: pickField(row, ["Tipo", "Type", "Status", "Sign Type"]),
          });
        }
      }

      const noPagados = noPagadosRows.length;
      setResult({
        totalEpod,
        pagados,
        noPagados,
        importeEstimado: noPagados * mediaBill,
        mediaBill,
        rows: noPagadosRows,
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? `No se pudo analizar: ${e.message}`
          : "No se pudo analizar los archivos",
      );
    } finally {
      setLoading(false);
    }
  };

  const descargarExcel = () => {
    if (!result) return;
    const wb = XLSX.utils.book_new();
    const summary = [
      ["Métrica", "Valor"],
      ["Total ePOD", result.totalEpod],
      ["Pagados", result.pagados],
      ["No pagados", result.noPagados],
      ["Media Bill Amount", Number(result.mediaBill.toFixed(2))],
      ["Importe estimado", Number(result.importeEstimado.toFixed(2))],
    ];
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(summary),
      "Resumen",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        result.rows.map((r) => ({
          "LP No.": r.lp,
          Repartidor: r.repartidor,
          Fecha: r.fecha,
          CP: r.cp,
          Tipo: r.tipo,
        })),
      ),
      "No pagados",
    );
    XLSX.writeFile(
      wb,
      `facturacion_no_pagados_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  const canAnalyze = !!epod && !!factura && !loading;

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      {/* TOPBAR */}
      <header className="h-16 border-b border-hairline flex items-center justify-between px-6 lg:px-10 shrink-0 sticky top-0 bg-background/80 backdrop-blur-md z-40">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="size-8 bg-electric flex items-center justify-center rounded-md">
              <span className="font-playfair italic font-extrabold text-white text-lg leading-none">
                M
              </span>
            </div>
            <span className="font-playfair italic font-extrabold tracking-tight text-lg text-ink">
              Men<span className="text-electric">s</span>sajero
            </span>
          </Link>
          <span className="text-surface-3">/</span>
          <span className="text-muted-text font-mono text-[11px] tracking-widest uppercase">
            Facturación
          </span>
        </div>
        <nav className="flex items-center gap-1">
          <Link
            to="/reportes"
            className="px-3 py-1.5 text-xs font-syne font-semibold text-muted-text hover:text-ink rounded transition-colors"
          >
            Reportes
          </Link>
          <Link
            to="/facturacion"
            className="px-3 py-1.5 text-xs font-syne font-semibold text-ink bg-surface-2 rounded transition-colors"
          >
            Facturación
          </Link>
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-5xl mx-auto">
          <header className="mb-12 animate-fade-up">
            <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4 flex items-center gap-2">
              <span className="size-1 bg-electric rounded-full" />
              Conciliación de facturación
            </div>
            <h1 className="text-4xl lg:text-6xl font-syne font-extrabold leading-[0.95] text-ink tracking-tighter uppercase">
              Detecta paquetes
              <br />
              <span className="font-playfair italic font-medium text-electric normal-case tracking-normal">
                no facturados
              </span>
            </h1>
            <p className="mt-6 text-muted-text text-pretty max-w-[52ch] text-[15px] leading-relaxed">
              Cruza tu ePOD con la factura de Cainiao y descubre los paquetes
              entregados que no han sido pagados.
            </p>
          </header>

          {/* UPLOAD ZONES */}
          <section
            className="grid md:grid-cols-2 gap-4 mb-6 animate-fade-up"
            style={{ animationDelay: "60ms" }}
          >
            <UploadZone
              label="ePOD"
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
              label="Factura Cainiao"
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
            <div className="mb-6 px-4 py-2.5 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs rounded-r">
              {error}
            </div>
          )}

          {/* ANALYZE */}
          <section
            className="mb-12 animate-fade-up"
            style={{ animationDelay: "120ms" }}
          >
            <button
              onClick={analizar}
              disabled={!canAnalyze}
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold font-syne tracking-tight rounded-md bg-electric text-white hover:brightness-110 transition-all disabled:bg-surface-2 disabled:text-muted-text disabled:cursor-not-allowed disabled:border disabled:border-hairline"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {loading ? "Analizando" : "Analizar"}
            </button>
            {!canAnalyze && !loading && (
              <span className="ml-3 font-mono text-[10px] text-muted-text tracking-widest uppercase">
                Sube ambos archivos para continuar
              </span>
            )}
          </section>

          {/* RESULTS */}
          {result && (
            <section className="animate-fade-up space-y-8">
              <div>
                <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4">
                  Resumen
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden">
                  <KpiCard label="Total ePOD" value={result.totalEpod.toLocaleString("es-ES")} />
                  <KpiCard
                    label="Pagados"
                    value={result.pagados.toLocaleString("es-ES")}
                    tone="success"
                  />
                  <KpiCard
                    label="No pagados"
                    value={result.noPagados.toLocaleString("es-ES")}
                    tone="danger"
                  />
                  <KpiCard
                    label="Importe estimado"
                    value={`${result.importeEstimado.toLocaleString("es-ES", {
                      maximumFractionDigits: 2,
                    })} €`}
                    tone="electric"
                  />
                </div>
                <div className="mt-2 font-mono text-[10px] text-muted-text/70 tracking-widest uppercase">
                  Media Bill Amount: {result.mediaBill.toFixed(2)} €
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase">
                    Paquetes no pagados · {result.noPagados}
                  </div>
                  <button
                    onClick={descargarExcel}
                    disabled={result.noPagados === 0}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold font-syne tracking-tight rounded-md bg-ink text-white hover:bg-ink/90 transition-all disabled:bg-surface-2 disabled:text-muted-text disabled:cursor-not-allowed disabled:border disabled:border-hairline"
                  >
                    <ArrowDown className="size-3.5" />
                    Descargar Excel
                  </button>
                </div>

                {result.rows.length === 0 ? (
                  <div className="p-8 text-center border border-hairline rounded-lg bg-surface">
                    <Check className="size-6 text-success mx-auto mb-2" />
                    <p className="font-syne text-ink text-sm">
                      Todos los paquetes del ePOD están facturados.
                    </p>
                  </div>
                ) : (
                  <div className="border border-hairline rounded-lg overflow-hidden bg-surface">
                    <div className="overflow-x-auto max-h-[480px]">
                      <table className="w-full text-[13px]">
                        <thead className="bg-surface-2 sticky top-0">
                          <tr className="text-left">
                            <Th>LP No.</Th>
                            <Th>Repartidor</Th>
                            <Th>Fecha</Th>
                            <Th>CP</Th>
                            <Th>Tipo</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.map((r, i) => (
                            <tr
                              key={`${r.lp}-${i}`}
                              className="border-t border-hairline hover:bg-ink/[0.02]"
                            >
                              <Td mono>{r.lp}</Td>
                              <Td>{r.repartidor || "—"}</Td>
                              <Td mono>{r.fecha || "—"}</Td>
                              <Td mono>{r.cp || "—"}</Td>
                              <Td>{r.tipo || "—"}</Td>
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
        </div>
      </div>
    </div>
  );
}

function UploadZone({
  label,
  hint,
  accept,
  file,
  onFile,
  onClear,
  inputRef,
}: {
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  onFile: (f: File | undefined) => void;
  onClear: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [dragOver, setDragOver] = useState(false);
  if (file) {
    return (
      <div className="flex items-center gap-4 p-5 bg-surface border border-hairline rounded-lg">
        <div className="size-10 bg-electric/10 border border-electric/30 rounded flex items-center justify-center shrink-0">
          <Check className="size-4 text-electric" strokeWidth={2.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase mb-0.5">
            {label}
          </div>
          <div className="font-mono text-sm text-ink truncate">{file.name}</div>
          <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase mt-0.5">
            {formatSize(file.size)}
          </div>
        </div>
        <button
          onClick={onClear}
          className="size-8 rounded grid place-items-center text-muted-text hover:text-ink hover:bg-ink/5 transition-colors"
          aria-label="Quitar archivo"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFile(e.dataTransfer.files?.[0]);
      }}
      onClick={() => inputRef.current?.click()}
      className={`group relative border-2 border-dashed transition-colors p-8 flex flex-col items-center justify-center rounded-lg cursor-pointer ${
        dragOver
          ? "border-electric bg-electric/[0.04]"
          : "border-surface-3 hover:border-electric/50 hover:bg-ink/[0.02]"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0] ?? undefined)}
      />
      <div className="size-10 bg-surface-2 rounded-md flex items-center justify-center mb-3 ring-1 ring-hairline">
        <Upload className="size-4 text-electric" strokeWidth={1.75} />
      </div>
      <h3 className="font-syne text-base mb-1 text-ink">{label}</h3>
      <p className="text-muted-text text-[10px] font-mono tracking-widest uppercase">
        {hint} · arrastra o haz click
      </p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger" | "electric";
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : tone === "electric"
          ? "text-electric"
          : "text-ink";
  return (
    <div className="bg-background p-6">
      <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-muted-text mb-3">
        {label}
      </div>
      <div className={`font-syne font-extrabold text-3xl tracking-tighter ${color}`}>
        {value}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 font-mono text-[10px] tracking-widest uppercase text-muted-text font-medium">
      {children}
    </th>
  );
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td className={`px-4 py-2.5 text-ink ${mono ? "font-mono text-[12px]" : ""}`}>
      {children}
    </td>
  );
}

function AlertCircleIcon() {
  return <AlertCircle className="size-3" />;
}
void AlertCircleIcon;
