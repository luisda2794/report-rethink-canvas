import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Copy, ChevronDown, ChevronRight } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { HubCombobox } from "@/components/HubCombobox";
import { resolveEventDate } from "@/lib/resolve-event-date";
import { getAllHubs, getEpodData, requireFields, type EpodField } from "@/lib/epodStore";

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

const REQUIRED_FIELDS: EpodField[] = ["waybill", "fecha", "estado", "incidencia"];

function normalizeEstado(s: string): string {
  return s.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
function isDeliveredState(s: string): boolean {
  const n = normalizeEstado(s);
  return n === "entregado" || n === "delivered" || n === "return to seller success";
}
function isFailedState(s: string): boolean {
  const n = normalizeEstado(s);
  return n === "attempt failure" || n === "return to seller fail";
}
function isCancelarState(s: string): boolean {
  const n = normalizeEstado(s);
  return n === "cancelar" || n === "cancel" || n === "cancelled" || n === "canceled";
}

type RawRow = {
  waybill: string;
  fecha: Date | null;
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

function formatFecha(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
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
      const at = a.fecha ? a.fecha.getTime() : 0;
      const bt = b.fecha ? b.fecha.getTime() : 0;
      if (at === bt) return a.rowIndex - b.rowIndex;
      return at - bt;
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

  const entregadosReal = groups.filter((g) => isDeliveredState(g.finalEstado)).length;
  const incidenciasReal = groups.filter((g) => isFailedState(g.finalEstado)).length;
  const canceladosReal = groups.filter((g) => isCancelarState(g.finalEstado)).length;

  const entregadosCai = rows.filter((r) => isDeliveredState(r.estado)).length;
  const incidenciasCai = rows.filter((r) => isFailedState(r.estado)).length;
  const canceladosCai = rows.filter((r) => isCancelarState(r.estado)).length;

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
            rowIndex: r.rowIndex,
          };
        });
        setRows(parsed);
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

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Duplicados
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Detección de paquetes duplicados y cálculo de tasas reales vs. Cainiao.
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
              Real vs Cainiao
            </h2>
            <div className="bg-card border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5">Concepto</th>
                    <th className="text-right px-4 py-2.5">Real (dedup)</th>
                    <th className="text-right px-4 py-2.5">Cainiao (bruto)</th>
                    <th className="text-right px-4 py-2.5">Δ</th>
                  </tr>
                </thead>
                <tbody>
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
              <span className="text-[11px] text-muted-foreground font-normal">
                ({analysis.duplicatedGroups.length})
              </span>
            </h2>
            {analysis.duplicatedGroups.length === 0 ? (
              <div className="p-6 bg-card border rounded-lg text-sm text-muted-foreground">
                No hay waybills duplicados en este archivo.
              </div>
            ) : (
              <div className="bg-card border rounded-lg divide-y divide-border">
                {analysis.duplicatedGroups.map((g) => (
                  <DuplicateRow key={g.waybill} group={g} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
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
          ? "bg-primary/10 border-primary/25 text-foreground"
          : "bg-card text-foreground"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide opacity-70">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && (
        <div className="mt-1 text-[11px] opacity-60">{hint}</div>
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
      : "text-muted-foreground";
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-3 font-semibold text-foreground">{label}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        <div className="text-foreground">{realAbs.toLocaleString("es-ES")}</div>
        <div className="text-[11px] text-muted-foreground">{realPct.toFixed(2)}%</div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <div className="text-foreground">{caiAbs.toLocaleString("es-ES")}</div>
        <div className="text-[11px] text-muted-foreground">{caiPct.toFixed(2)}%</div>
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
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted text-left"
      >
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
        <div className="flex-1 text-sm text-foreground truncate">
          {group.waybill}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {group.rows.length}×
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-foreground">
          {group.finalEstado || "—"}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <table className="w-full text-[12px] border rounded overflow-hidden">
            <thead className="bg-muted text-muted-foreground uppercase text-[10px]">
              <tr>
                <th className="text-left px-3 py-1.5">#</th>
                <th className="text-left px-3 py-1.5">Fecha</th>
                <th className="text-left px-3 py-1.5">Estado</th>
                <th className="text-left px-3 py-1.5">Incidencia</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-1.5 text-foreground">{formatFecha(r.fecha)}</td>
                  <td className="px-3 py-1.5 text-foreground">{r.estado || "—"}</td>
                  <td className="px-3 py-1.5 text-foreground">{r.incidencia || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
