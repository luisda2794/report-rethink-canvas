import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Check,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  Save,
  Download,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Calendar as CalendarIcon,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/borradores")({
  component: () => (
    <RequireAuth path="/borradores">
      <BorradoresPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Borradores" }] }),
});

// ============================================================
// TYPES
// ============================================================

type Tarifa = {
  id?: string;
  hub_id: string;
  codigo_postal: string;
  precio_door: number;
  precio_pudo: number;
  precio_aa: number;
  _dirty?: boolean;
  _new?: boolean;
};

type DraftLine = {
  cp: string;
  tipo: "TO_DOOR" | "PUDO" | "AA";
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
};

type DraftResult = {
  driver_nombre: string;
  total_paquetes: number;
  base_imponible: number;
  iva_21: number;
  total: number;
  fecha_desde: string;
  fecha_hasta: string;
  lineas: DraftLine[];
  warnings: string[];
};

type SavedBorrador = {
  id: string;
  driver_nombre: string;
  fecha_desde: string;
  fecha_hasta: string;
  total_paquetes: number;
  base_imponible: number;
  iva_21: number;
  total: number;
  estado: "borrador" | "confirmado" | "facturado";
  created_at: string;
};

// ============================================================
// ENTREGAS PROCESSING (from Supabase)
// ============================================================

type EntregaRow = {
  driver: string | null;
  fecha: string | null;
  cp: string | null;
  tipo: string | null;
  tipo_norm: string | null;
  es_aa: boolean | null;
};

function processEntregas(rows: EntregaRow[], tarifas: Tarifa[]): DraftResult[] {
  if (rows.length === 0) return [];

  const tarifaMap = new Map(tarifas.map((t) => [t.codigo_postal.trim(), t]));

  type Row = { driver: string; cp: string; tipo: "PUDO" | "TO_DOOR" | "AA"; fecha: string };
  const filtered: Row[] = [];
  for (const r of rows) {
    const rawDriver = (r.driver ?? "").trim();
    if (!rawDriver) continue;
    const driver = rawDriver.split(" | ")[0].trim();
    const tn = (r.tipo_norm ?? r.tipo ?? "").trim().toUpperCase();
    const base: "PUDO" | "TO_DOOR" = tn === "PUDO" ? "PUDO" : "TO_DOOR";
    const tipo: "PUDO" | "TO_DOOR" | "AA" = r.es_aa && base === "TO_DOOR" ? "AA" : base;
    filtered.push({
      driver,
      cp: (r.cp ?? "").trim(),
      tipo,
      fecha: r.fecha ?? "",
    });
  }

  const byDriver = new Map<string, Row[]>();
  for (const r of filtered) {
    if (!byDriver.has(r.driver)) byDriver.set(r.driver, []);
    byDriver.get(r.driver)!.push(r);
  }

  const dates = filtered.map((r) => r.fecha).filter(Boolean).sort();
  const fecha_desde = dates[0] || new Date().toISOString().slice(0, 10);
  const fecha_hasta = dates[dates.length - 1] || fecha_desde;

  const results: DraftResult[] = [];
  for (const [driver, rs] of byDriver) {
    const agg = new Map<string, { cp: string; tipo: "TO_DOOR" | "PUDO" | "AA"; cantidad: number }>();
    const warningsSet = new Set<string>();
    for (const r of rs) {
      const key = `${r.cp}|${r.tipo}`;
      if (!agg.has(key)) agg.set(key, { cp: r.cp, tipo: r.tipo, cantidad: 0 });
      agg.get(key)!.cantidad++;
    }
    const lineas: DraftLine[] = [];
    let base = 0;
    let total_paquetes = 0;
    for (const { cp, tipo, cantidad } of agg.values()) {
      const tar = tarifaMap.get(cp);
      let precio = 0;
      if (!tar) {
        warningsSet.add(`CP ${cp} sin tarifa configurada`);
      } else {
        precio = tipo === "PUDO"
          ? Number(tar.precio_pudo)
          : tipo === "AA"
            ? Number(tar.precio_aa)
            : Number(tar.precio_door);
      }
      const subtotal = +(cantidad * precio).toFixed(2);
      lineas.push({ cp, tipo, cantidad, precio_unitario: precio, subtotal });
      base += subtotal;
      total_paquetes += cantidad;
    }
    lineas.sort((a, b) => a.cp.localeCompare(b.cp) || a.tipo.localeCompare(b.tipo));
    base = +base.toFixed(2);
    const iva_21 = +(base * 0.21).toFixed(2);
    const total = +(base + iva_21).toFixed(2);
    results.push({
      driver_nombre: driver,
      total_paquetes,
      base_imponible: base,
      iva_21,
      total,
      fecha_desde,
      fecha_hasta,
      lineas,
      warnings: [...warningsSet],
    });
  }
  results.sort((a, b) => b.total - a.total);
  return results;
}

// ============================================================
// EXCEL EXPORT
// ============================================================

function exportBorradorExcel(d: DraftResult, hubMarca: string) {
  const ws_data: (string | number)[][] = [
    [`${hubMarca} — ${d.driver_nombre}`],
    [`Período: ${d.fecha_desde} → ${d.fecha_hasta}`],
    [],
    ["CP", "Tipo", "Cantidad", "Precio unit.", "Subtotal"],
    ...d.lineas.map((l) => [l.cp, l.tipo, l.cantidad, l.precio_unitario, l.subtotal]),
    [],
    ["", "", "", "Base imponible", d.base_imponible],
    ["", "", "", "IVA 21%", d.iva_21],
    ["", "", "", "Total", d.total],
  ];
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Borrador");
  const safe = d.driver_nombre.replace(/[^a-z0-9]+/gi, "_");
  XLSX.writeFile(wb, `Borrador_${safe}_${d.fecha_desde}_${d.fecha_hasta}.xlsx`);
}

// ============================================================
// PAGE
// ============================================================

function BorradoresPage() {
  const { selectedHub } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Borradores" />
      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-6xl mx-auto space-y-16">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Borradores de factura
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Hub:{" "}
              <span className="text-foreground font-medium">
                {selectedHub ? `${selectedHub.marca} · ${selectedHub.nombre}` : "—"}
              </span>
            </p>
          </header>

          {!selectedHub ? (
            <div className="px-4 py-6 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs rounded-r">
              Selecciona un hub en la barra superior para empezar.
            </div>
          ) : (
            <>
              <TarifasSection hubId={selectedHub.id} />
              <GeneradorSection hubId={selectedHub.id} hubMarca={selectedHub.marca} />
              <SavedBorradoresSection hubId={selectedHub.id} hubMarca={selectedHub.marca} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SECTION 1: TARIFAS
// ============================================================

function TarifasSection({ hubId }: { hubId: string }) {
  const [tarifas, setTarifas] = useState<Tarifa[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("driver_tarifas")
      .select("id, hub_id, codigo_postal, precio_door, precio_pudo, precio_aa")
      .eq("hub_id", hubId)
      .order("codigo_postal");
    if (error) toast.error(error.message);
    setTarifas(
      (data ?? []).map((t) => ({
        id: t.id,
        hub_id: t.hub_id,
        codigo_postal: t.codigo_postal,
        precio_door: Number(t.precio_door),
        precio_pudo: Number(t.precio_pudo),
        precio_aa: Number(t.precio_aa),
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubId]);

  const updateField = (idx: number, field: keyof Tarifa, value: string) => {
    setTarifas((prev) =>
      prev.map((t, i) =>
        i === idx
          ? {
              ...t,
              [field]: field === "codigo_postal" ? value : Number(value) || 0,
              _dirty: true,
            }
          : t,
      ),
    );
  };

  const addRow = () => {
    setTarifas((prev) => [
      ...prev,
      {
        hub_id: hubId,
        codigo_postal: "",
        precio_door: 1.05,
        precio_pudo: 0.3,
        precio_aa: 0.3,
        _new: true,
        _dirty: true,
      },
    ]);
  };

  const removeRow = async (idx: number) => {
    const t = tarifas[idx];
    if (t.id) {
      const { error } = await supabase.from("driver_tarifas").delete().eq("id", t.id);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    setTarifas((prev) => prev.filter((_, i) => i !== idx));
    toast.success("Tarifa eliminada");
  };

  const saveAll = async () => {
    setSaving(true);
    const dirty = tarifas.filter((t) => t._dirty && t.codigo_postal.trim());
    if (dirty.length === 0) {
      toast.info("No hay cambios pendientes");
      setSaving(false);
      return;
    }
    const payload = dirty.map((t) => ({
      ...(t.id ? { id: t.id } : {}),
      hub_id: hubId,
      codigo_postal: t.codigo_postal.trim(),
      precio_door: t.precio_door,
      precio_pudo: t.precio_pudo,
      precio_aa: t.precio_aa,
    }));
    const { error } = await supabase
      .from("driver_tarifas")
      .upsert(payload, { onConflict: "hub_id,codigo_postal" });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`${dirty.length} tarifa(s) guardadas`);
      await load();
    }
    setSaving(false);
  };

  return (
    <section className="animate-fade-up">
      <div className="mb-6">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Tarifas por CP
        </h2>
        <p className="text-muted-text text-sm mt-1">
          Configura el precio por tipo de entrega para cada código postal.
        </p>
      </div>

      <div className="bg-surface border border-hairline rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-hairline font-mono text-[10px] tracking-widest uppercase text-muted-text">
                <th className="text-left px-4 py-3">Código Postal</th>
                <th className="text-right px-4 py-3">TO_DOOR (€)</th>
                <th className="text-right px-4 py-3">PUDO (€)</th>
                <th className="text-right px-4 py-3">AA (€)</th>
                <th className="px-4 py-3 w-16" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-text font-mono text-xs">
                    Cargando…
                  </td>
                </tr>
              ) : tarifas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-text font-mono text-xs">
                    Sin tarifas configuradas
                  </td>
                </tr>
              ) : (
                tarifas.map((t, idx) => (
                  <tr
                    key={t.id ?? `new-${idx}`}
                    className={`border-b border-hairline/50 ${t._dirty ? "bg-electric/5" : ""}`}
                  >
                    <td className="px-4 py-2">
                      <input
                        value={t.codigo_postal}
                        onChange={(e) => updateField(idx, "codigo_postal", e.target.value)}
                        placeholder="28001"
                        className="w-full bg-transparent border-0 focus:ring-0 focus:outline-none font-mono text-sm text-ink"
                      />
                    </td>
                    {(["precio_door", "precio_pudo", "precio_aa"] as const).map((f) => (
                      <td key={f} className="px-4 py-2 text-right">
                        <input
                          type="number"
                          step="0.0001"
                          value={t[f] as number}
                          onChange={(e) => updateField(idx, f, e.target.value)}
                          className="w-24 bg-transparent border-0 focus:ring-0 focus:outline-none font-mono text-sm text-ink text-right"
                        />
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => removeRow(idx)}
                        className="text-muted-text hover:text-danger transition-colors"
                        aria-label="Eliminar tarifa"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between p-4 bg-surface-2/50 border-t border-hairline">
          <button
            onClick={addRow}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-widest uppercase text-ink hover:text-electric transition-colors"
          >
            <Plus className="size-3.5" /> Añadir CP
          </button>
          <button
            onClick={saveAll}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded font-mono text-xs tracking-widest uppercase hover:bg-electric transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Guardar cambios
          </button>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// SECTION 2: GENERADOR
// ============================================================

function isoToday() { return new Date().toISOString().slice(0, 10); }
function isoDaysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

function GeneradorSection({ hubId, hubMarca }: { hubId: string; hubMarca: string }) {
  const [fromDate, setFromDate] = useState<string>(isoDaysAgo(7));
  const [toDate, setToDate] = useState<string>(isoToday());
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<DraftResult[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [tarifasCount, setTarifasCount] = useState(0);
  const [periodCount, setPeriodCount] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("driver_tarifas")
      .select("id", { count: "exact", head: true })
      .eq("hub_id", hubId)
      .then(({ count }) => setTarifasCount(count ?? 0));
  }, [hubId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { count } = await supabase
        .from("entregas")
        .select("id", { count: "exact", head: true })
        .eq("hub_id", hubId)
        .gte("fecha", fromDate)
        .lte("fecha", toDate);
      if (!cancelled) setPeriodCount(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [hubId, fromDate, toDate]);

  const fetchEntregas = async (): Promise<EntregaRow[]> => {
    const all: EntregaRow[] = [];
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error: qErr } = await supabase
        .from("entregas")
        .select("driver, fecha, cp, tipo, tipo_norm, es_aa")
        .eq("hub_id", hubId)
        .gte("fecha", fromDate)
        .lte("fecha", toDate)
        .range(from, from + pageSize - 1);
      if (qErr) throw qErr;
      const rows = (data ?? []) as EntregaRow[];
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return all;
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const { data: tarifasData, error: tErr } = await supabase
        .from("driver_tarifas")
        .select("id, hub_id, codigo_postal, precio_door, precio_pudo, precio_aa")
        .eq("hub_id", hubId);
      if (tErr) throw tErr;
      const tarifas: Tarifa[] = (tarifasData ?? []).map((t) => ({
        id: t.id,
        hub_id: t.hub_id,
        codigo_postal: t.codigo_postal,
        precio_door: Number(t.precio_door),
        precio_pudo: Number(t.precio_pudo),
        precio_aa: Number(t.precio_aa),
      }));
      const rows = await fetchEntregas();
      const res = processEntregas(rows, tarifas);
      // Override fecha_desde/hasta with chosen period for consistency
      for (const r of res) { r.fecha_desde = fromDate; r.fecha_hasta = toDate; }
      setResults(res);
      setSavedIds(new Set());
      if (res.length === 0) toast.warning("No hay entregas en el período seleccionado");
      else toast.success(`${res.length} borrador(es) generados`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error generando borradores";
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  const toggleExpand = (driver: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(driver)) n.delete(driver); else n.add(driver);
      return n;
    });
  };

  const saveBorrador = async (d: DraftResult) => {
    const { data: b, error: bErr } = await supabase
      .from("borradores")
      .insert({
        hub_id: hubId,
        driver_nombre: d.driver_nombre,
        fecha_desde: d.fecha_desde,
        fecha_hasta: d.fecha_hasta,
        total_paquetes: d.total_paquetes,
        base_imponible: d.base_imponible,
        iva_21: d.iva_21,
        total: d.total,
        estado: "borrador",
      })
      .select("id")
      .single();
    if (bErr || !b) { toast.error(bErr?.message ?? "Error guardando borrador"); return false; }
    const lineas = d.lineas.map((l) => ({
      borrador_id: b.id,
      codigo_postal: l.cp,
      tipo_entrega: l.tipo,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario,
      subtotal: l.subtotal,
    }));
    if (lineas.length > 0) {
      const { error: lErr } = await supabase.from("borrador_lineas").insert(lineas);
      if (lErr) { toast.error(lErr.message); return false; }
    }
    setSavedIds((prev) => new Set(prev).add(d.driver_nombre));
    return true;
  };

  const saveOne = async (d: DraftResult) => {
    if (await saveBorrador(d)) toast.success(`Borrador de ${d.driver_nombre} guardado`);
  };

  const saveAll = async () => {
    let ok = 0;
    for (const d of results) {
      if (savedIds.has(d.driver_nombre)) continue;
      if (await saveBorrador(d)) ok++;
    }
    if (ok > 0) toast.success(`${ok} borrador(es) guardados`);
  };

  const downloadAll = () => results.forEach((d) => exportBorradorExcel(d, hubMarca));

  const hasData = (periodCount ?? 0) > 0;
  const canGenerate = hasData && tarifasCount > 0 && !generating;

  return (
    <section className="animate-fade-up">
      <div className="mb-6">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Generar borradores
        </h2>
        <p className="text-muted-text text-sm mt-1">
          Selecciona el período y genera los borradores por driver desde los datos cargados en{" "}
          <Link to="/epod" className="text-electric hover:underline">/epod</Link>.
        </p>
      </div>

      <div className="p-4 bg-surface border border-hairline rounded-lg flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] tracking-widest uppercase text-muted-text inline-flex items-center gap-1.5">
          <CalendarIcon className="size-3.5 text-electric" /> Período
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-text">Desde</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="border border-hairline rounded px-2 py-1 text-xs bg-background font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-text">Hasta</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="border border-hairline rounded px-2 py-1 text-xs bg-background font-mono"
          />
        </div>
        <button
          onClick={generate}
          disabled={!canGenerate}
          className="ml-auto inline-flex items-center gap-2 px-4 py-2 bg-electric text-white rounded font-mono text-xs tracking-widest uppercase hover:bg-electric/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generating ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
          Generar borradores
        </button>
      </div>

      {/* Status indicator */}
      <div className="mt-3">
        {periodCount === null ? (
          <div className="px-4 py-2.5 border-l-2 border-hairline bg-surface text-muted-text font-mono text-xs rounded-r inline-flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" /> Comprobando entregas…
          </div>
        ) : hasData ? (
          <div className="px-4 py-2.5 border-l-2 border-emerald-500 bg-emerald-500/10 text-emerald-700 font-mono text-xs rounded-r inline-flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-500" />
            <span><span className="font-bold">{periodCount.toLocaleString("es-ES")}</span> paquetes entregados en el período</span>
          </div>
        ) : (
          <div className="px-4 py-2.5 border-l-2 border-amber-500 bg-amber-500/10 text-amber-700 font-mono text-xs rounded-r inline-flex items-center gap-2">
            <span className="size-2 rounded-full bg-amber-500" />
            <span>Sin entregas en el período · <Link to="/epod" className="underline hover:text-amber-900">Sube un ePOD</Link></span>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 px-4 py-2.5 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs rounded-r flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" /> {error}
        </div>
      )}

      {tarifasCount === 0 && (
        <div className="mt-3 px-4 py-2.5 border-l-2 border-amber-500 bg-amber-500/10 text-amber-700 font-mono text-xs rounded-r flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" />
          Configura al menos un CP en tarifas antes de generar.
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-10 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-syne font-bold text-lg text-ink tracking-tight">
              Resultados ({results.length})
            </h3>
            <div className="flex gap-2">
              <button
                onClick={downloadAll}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-widest uppercase border border-hairline rounded hover:border-electric hover:text-electric transition-colors"
              >
                <Download className="size-3.5" /> Descargar todos
              </button>
              <button
                onClick={saveAll}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-widest uppercase bg-ink text-white rounded hover:bg-electric transition-colors"
              >
                <Save className="size-3.5" /> Guardar todos
              </button>
            </div>
          </div>

          {results.map((d) => {
            const open = expanded.has(d.driver_nombre);
            const saved = savedIds.has(d.driver_nombre);
            return (
              <article key={d.driver_nombre} className="bg-surface border border-hairline rounded-lg overflow-hidden">
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer hover:bg-surface-2 transition-colors"
                  onClick={() => toggleExpand(d.driver_nombre)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-syne font-bold text-ink text-base">{d.driver_nombre}</div>
                    <div className="font-mono text-[10px] tracking-widest text-muted-text uppercase mt-0.5">
                      {d.total_paquetes} paquetes · {d.fecha_desde} → {d.fecha_hasta}
                    </div>
                  </div>
                  <div className="font-playfair italic font-medium text-electric text-2xl tabular-nums">
                    {d.total.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
                  </div>
                  {open ? <ChevronUp className="size-4 text-muted-text" /> : <ChevronDown className="size-4 text-muted-text" />}
                </div>

                {open && (
                  <div className="border-t border-hairline">
                    {d.warnings.length > 0 && (
                      <div className="px-5 py-2.5 bg-amber-500/10 border-b border-hairline text-amber-700 font-mono text-[11px]">
                        ⚠ {d.warnings.join(" · ")}
                      </div>
                    )}
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-surface-2 font-mono text-[10px] tracking-widest uppercase text-muted-text">
                          <th className="text-left px-5 py-2">CP</th>
                          <th className="text-left px-5 py-2">Tipo</th>
                          <th className="text-right px-5 py-2">Cant.</th>
                          <th className="text-right px-5 py-2">Precio</th>
                          <th className="text-right px-5 py-2">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.lineas.map((l, i) => (
                          <tr key={i} className="border-t border-hairline/50">
                            <td className="px-5 py-1.5 font-mono">{l.cp}</td>
                            <td className="px-5 py-1.5 font-mono text-xs">{l.tipo}</td>
                            <td className="px-5 py-1.5 text-right tabular-nums">{l.cantidad}</td>
                            <td className="px-5 py-1.5 text-right tabular-nums font-mono">
                              {l.precio_unitario.toFixed(4)} €
                            </td>
                            <td className="px-5 py-1.5 text-right tabular-nums">
                              {l.subtotal.toFixed(2)} €
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-hairline bg-surface-2/50 font-mono text-xs">
                          <td colSpan={3} />
                          <td className="px-5 py-1.5 text-right text-muted-text">Base</td>
                          <td className="px-5 py-1.5 text-right tabular-nums">{d.base_imponible.toFixed(2)} €</td>
                        </tr>
                        <tr className="bg-surface-2/50 font-mono text-xs">
                          <td colSpan={3} />
                          <td className="px-5 py-1.5 text-right text-muted-text">IVA 21%</td>
                          <td className="px-5 py-1.5 text-right tabular-nums">{d.iva_21.toFixed(2)} €</td>
                        </tr>
                        <tr className="bg-surface-2 font-mono text-sm font-bold">
                          <td colSpan={3} />
                          <td className="px-5 py-2 text-right">Total</td>
                          <td className="px-5 py-2 text-right tabular-nums text-electric">
                            {d.total.toFixed(2)} €
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                    <div className="flex gap-2 p-4 border-t border-hairline bg-surface-2/30">
                      <button
                        onClick={() => exportBorradorExcel(d, hubMarca)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-widest uppercase border border-hairline rounded hover:border-electric hover:text-electric transition-colors"
                      >
                        <Download className="size-3.5" /> Excel
                      </button>
                      <button
                        onClick={() => saveOne(d)}
                        disabled={saved}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-widest uppercase bg-ink text-white rounded hover:bg-electric transition-colors disabled:opacity-50"
                      >
                        {saved ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
                        {saved ? "Guardado" : "Guardar borrador"}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ============================================================
// SECTION 3: SAVED BORRADORES
// ============================================================

const ESTADO_BADGE: Record<SavedBorrador["estado"], string> = {
  borrador: "bg-surface-2 text-muted-text border-hairline",
  confirmado: "bg-electric/10 text-electric border-electric/30",
  facturado: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
};

const NEXT_ESTADO: Record<SavedBorrador["estado"], SavedBorrador["estado"]> = {
  borrador: "confirmado",
  confirmado: "facturado",
  facturado: "borrador",
};

function SavedBorradoresSection({ hubId, hubMarca }: { hubId: string; hubMarca: string }) {
  const [items, setItems] = useState<SavedBorrador[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("borradores")
      .select("id, driver_nombre, fecha_desde, fecha_hasta, total_paquetes, base_imponible, iva_21, total, estado, created_at")
      .eq("hub_id", hubId)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setItems((data ?? []) as SavedBorrador[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubId]);

  const cycleEstado = async (b: SavedBorrador) => {
    const next = NEXT_ESTADO[b.estado];
    const { error } = await supabase.from("borradores").update({ estado: next }).eq("id", b.id);
    if (error) toast.error(error.message);
    else {
      toast.success(`Estado → ${next}`);
      load();
    }
  };

  const remove = async (b: SavedBorrador) => {
    if (!confirm(`¿Eliminar borrador de ${b.driver_nombre}?`)) return;
    const { error } = await supabase.from("borradores").delete().eq("id", b.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Borrador eliminado");
      load();
    }
  };

  const download = async (b: SavedBorrador) => {
    const { data: lineas, error } = await supabase
      .from("borrador_lineas")
      .select("codigo_postal, tipo_entrega, cantidad, precio_unitario, subtotal")
      .eq("borrador_id", b.id)
      .order("codigo_postal");
    if (error) {
      toast.error(error.message);
      return;
    }
    const draft: DraftResult = {
      driver_nombre: b.driver_nombre,
      total_paquetes: b.total_paquetes,
      base_imponible: Number(b.base_imponible),
      iva_21: Number(b.iva_21),
      total: Number(b.total),
      fecha_desde: b.fecha_desde,
      fecha_hasta: b.fecha_hasta,
      warnings: [],
      lineas: (lineas ?? []).map((l) => ({
        cp: l.codigo_postal,
        tipo: l.tipo_entrega as DraftLine["tipo"],
        cantidad: l.cantidad,
        precio_unitario: Number(l.precio_unitario),
        subtotal: Number(l.subtotal),
      })),
    };
    exportBorradorExcel(draft, hubMarca);
  };

  return (
    <section className="animate-fade-up">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Borradores guardados
          </h2>
          <p className="text-muted-text text-sm mt-1">Historial de borradores generados.</p>
        </div>
        <span className="font-mono text-[10px] tracking-widest text-muted-text uppercase">
          {items.length} registros
        </span>
      </div>

      <div className="bg-surface border border-hairline rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-hairline font-mono text-[10px] tracking-widest uppercase text-muted-text">
                <th className="text-left px-4 py-3">Driver</th>
                <th className="text-left px-4 py-3">Período</th>
                <th className="text-right px-4 py-3">Paq.</th>
                <th className="text-right px-4 py-3">Base</th>
                <th className="text-right px-4 py-3">IVA</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-center px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-text font-mono text-xs">
                    Cargando…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-text font-mono text-xs">
                    Sin borradores guardados
                  </td>
                </tr>
              ) : (
                items.map((b) => (
                  <tr key={b.id} className="border-b border-hairline/50 hover:bg-surface-2/40 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-ink">{b.driver_nombre}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-text">
                      {b.fecha_desde} → {b.fecha_hasta}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{b.total_paquetes}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-mono text-xs">
                      {Number(b.base_imponible).toFixed(2)} €
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-mono text-xs">
                      {Number(b.iva_21).toFixed(2)} €
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {Number(b.total).toFixed(2)} €
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => cycleEstado(b)}
                        className={`px-2 py-0.5 text-[10px] font-mono tracking-widest uppercase border rounded ${ESTADO_BADGE[b.estado]} hover:opacity-80 transition-opacity`}
                        title="Cambiar estado"
                      >
                        {b.estado}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => download(b)}
                          className="size-7 rounded grid place-items-center text-muted-text hover:text-electric hover:bg-electric/10 transition-colors"
                          title="Descargar Excel"
                        >
                          <Download className="size-3.5" />
                        </button>
                        <button
                          onClick={() => remove(b)}
                          className="size-7 rounded grid place-items-center text-muted-text hover:text-danger hover:bg-danger/10 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
