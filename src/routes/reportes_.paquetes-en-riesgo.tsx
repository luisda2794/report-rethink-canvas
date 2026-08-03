import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import XLSXStyle from "xlsx-js-style";
import {
  AlertCircle,
  AlertTriangle,
  Download,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RequireAuth } from "@/components/RequireAuth";
import { HubCombobox } from "@/components/HubCombobox";
import { resolveEventDate } from "@/lib/resolve-event-date";
import { getAllHubs, getEpodData, requireFields, type EpodField } from "@/lib/epodStore";

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

const REQUIRED_FIELDS: EpodField[] = ["waybill", "fecha", "estado", "incidencia", "cp", "ciudad", "direccion", "driver"];

const EN_REPARTO_ESTADOS = new Set(["Driver_received", "Driver_received_incidencias"]);

type RawRow = {
  waybill: string;
  fecha: Date | null;
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
  if (level === "critico") return { cell: "bg-destructive text-destructive-foreground", hex: "B91C1C", fontHex: "FFFFFF" };
  if (level === "alto") return { cell: "bg-rose-300 text-red-900", hex: "FDA4AF", fontHex: "7F1D1D" };
  return { cell: "bg-warn text-foreground", hex: "F59E0B", fontHex: "FFFFFF" };
}

function PaquetesEnRiesgoPage() {
  const [hub, setHub] = useState("");
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasAnyHub, setHasAnyHub] = useState<boolean | null>(null);

  useEffect(() => {
    getAllHubs()
      .then((list) => setHasAnyHub(list.length > 0))
      .catch(() => setHasAnyHub(false));
  }, []);

  useEffect(() => {
    if (!hub.trim()) {
      setRows(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEpodData(hub.trim())
      .then((record) => {
        if (cancelled) return;
        if (!record) {
          setRows(null);
          setError(`No hay datos cargados para "${hub.trim()}".`);
          return;
        }
        requireFields(record.metadata.detectedFields, REQUIRED_FIELDS);
        const parsed: RawRow[] = record.rows.map((r) => {
          const fecha = resolveEventDate({
            estado: r.estado,
            fechaTarea: r.fecha ? new Date(r.fecha) : null,
            tiempoEntrega: r.tiempoEntrega ? new Date(r.tiempoEntrega) : null,
            tiempoFracaso: r.tiempoFracaso ? new Date(r.tiempoFracaso) : null,
          });
          return {
            waybill: r.waybill,
            fecha,
            estado: r.estado,
            incidencia: r.incidencia,
            cp: r.cp,
            ciudad: r.ciudad,
            direccion: r.direccion,
            repartidor: r.driver,
            rowIndex: r.rowIndex,
          };
        });
        setRows(parsed);

        const analysisNow = analyze(parsed);
        try {
          const key = "paquetes_en_riesgo_v1";
          const store = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<
            string,
            { fecha: string; total: number; updatedAt: string }
          >;
          store[hub.trim()] = {
            fecha: formatDate(analysisNow.maxDate),
            total: analysisNow.risk.length,
            updatedAt: new Date().toISOString(),
          };
          localStorage.setItem(key, JSON.stringify(store));
        } catch { /* ignore */ }
      })
      .catch((e) => {
        if (cancelled) return;
        setRows(null);
        setError(e instanceof Error ? e.message : "Error cargando los datos del hub.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hub]);

  const analysis = useMemo(() => (rows ? analyze(rows) : null), [rows]);

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
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/reportes"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Volver a Reportes
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Paquetes en Riesgo
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paquetes en reparto que rompen CD5 (5+ días desde inbound).
        </p>
      </header>

      {/* Hub selector */}
      <section className="mb-4">
        <label className="text-[11px] uppercase text-muted-foreground tracking-wide">
          Hub
        </label>
        <div className="mt-1">
          <HubCombobox value={hub} onChange={setHub} className="max-w-xs" />
        </div>
        {loading && <p className="mt-2 text-[12px] text-muted-foreground">Cargando datos del hub…</p>}
        {error && (
          <p className="mt-2 text-destructive text-[12px] flex items-start gap-1.5">
            <AlertCircle className="size-3 mt-0.5 shrink-0" />
            <span>{error}</span>
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
      </section>

      {analysis && (
        <>
          <section className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-lg border border-primary/25 bg-primary/10 text-foreground">
              <div className="text-[11px] uppercase tracking-wide opacity-70">
                Paquetes en riesgo
              </div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">
                {analysis.risk.length.toLocaleString("es-ES")}
              </div>
              <div className="mt-1 text-[11px] opacity-70">
                Rompen CD5 (≥5 días desde inbound)
              </div>
            </div>
            <div className="p-4 rounded-lg border bg-card text-foreground">
              <div className="text-[11px] uppercase tracking-wide opacity-70">
                Fecha del reporte
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {formatDate(analysis.maxDate)}
              </div>
              <div className="mt-1 text-[11px] opacity-60">
                Última fecha del archivo
              </div>
            </div>
            <div className="p-4 rounded-lg border bg-card text-foreground flex flex-col justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wide opacity-70">Hub</div>
                <div className="mt-1 text-2xl font-semibold">{hub}</div>
              </div>
              <Button onClick={exportXlsx} disabled={analysis.risk.length === 0} size="sm" className="mt-2 self-start gap-2">
                <Download className="size-3.5" /> Exportar Excel
              </Button>
            </div>
          </section>

          <section>
            {analysis.risk.length === 0 ? (
              <div className="p-6 bg-card border rounded-lg text-sm text-foreground">
                Sin paquetes en riesgo ✓
              </div>
            ) : (
              <div className="bg-card border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
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
                  <tbody>
                    {analysis.risk.map((r) => {
                      const level = riskLevel(r.diasDesdeInbound);
                      const colors = riskColors(level);
                      return (
                        <tr key={r.waybill} className="border-t border-border">
                          <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.waybill}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold tabular-nums ${colors.cell}`}>
                              {level === "critico" && <AlertTriangle className="size-3" />}
                              {r.diasDesdeInbound}d
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center text-foreground tabular-nums">{r.numIncidencias}</td>
                          <td className="px-3 py-2 text-foreground max-w-[280px] truncate" title={r.ultimaIncidencia}>{r.ultimaIncidencia}</td>
                          <td className="px-3 py-2 text-foreground">{r.cp || "—"}</td>
                          <td className="px-3 py-2 text-foreground">{r.ciudad || "—"}</td>
                          <td className="px-3 py-2 text-foreground max-w-[280px] truncate" title={r.direccion}>{r.direccion || "—"}</td>
                          <td className="px-3 py-2 text-foreground whitespace-nowrap">{r.repartidor || "—"}</td>
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
  );
}
