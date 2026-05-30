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
// EPOD PARSING
// ============================================================

const COL_DRIVER = ["Nombre del Repartidor", "Courier Name"];
const COL_CP = ["Código postal", "Zip Code"];
const COL_TIPO = ["Tipo de Entrega", "Delivery Type"];
const COL_ESTADO = ["Estado de la Tarea", "Task Status"];
const COL_FECHA = ["Fecha de la tarea", "Task Date"];
const COL_CONTACTO = ["Contacto", "Contact"];
const COL_DIR = ["Dirección detallada", "Detailed address"];

function findKey(row: Record<string, unknown>, candidates: string[]) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const k = keys.find((k) => k.trim().toLowerCase() === c.toLowerCase());
    if (k) return k;
  }
  // partial match
  for (const c of candidates) {
    const k = keys.find((k) => k.toLowerCase().includes(c.toLowerCase()));
    if (k) return k;
  }
  return null;
}

function normalizeTipo(t: string): "PUDO" | "TO_DOOR" {
  const v = (t || "").trim().toUpperCase();
  if (["PUDO", "TO_LOCKER", "PICK_UP_PUDO", "PICU_UP_PUDO"].includes(v)) return "PUDO";
  return "TO_DOOR";
}

function isDelivered(s: string) {
  const v = (s || "").trim().toLowerCase();
  return v === "entregado" || v === "delivered";
}

function parseDate(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  // try dd/mm/yyyy
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s);
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m2) return m2[0];
  return s.slice(0, 10);
}

function processEpod(rows: Record<string, unknown>[], tarifas: Tarifa[]): DraftResult[] {
  if (rows.length === 0) return [];
  const sample = rows[0];
  const kDriver = findKey(sample, COL_DRIVER);
  const kCp = findKey(sample, COL_CP);
  const kTipo = findKey(sample, COL_TIPO);
  const kEstado = findKey(sample, COL_ESTADO);
  const kFecha = findKey(sample, COL_FECHA);
  const kContacto = findKey(sample, COL_CONTACTO);
  const kDir = findKey(sample, COL_DIR);

  if (!kDriver || !kCp || !kTipo || !kEstado) {
    throw new Error(
      "No se detectaron las columnas necesarias en el ePOD (Driver, CP, Tipo, Estado).",
    );
  }

  const tarifaMap = new Map(tarifas.map((t) => [t.codigo_postal.trim(), t]));

  type Row = {
    driver: string;
    cp: string;
    tipo: "PUDO" | "TO_DOOR";
    fecha: string;
    contacto: string;
    direccion: string;
  };

  const filtered: Row[] = [];
  for (const r of rows) {
    if (!isDelivered(String(r[kEstado] ?? ""))) continue;
    const rawDriver = String(r[kDriver] ?? "").trim();
    if (!rawDriver) continue;
    const driver = rawDriver.split(" | ")[0].trim();
    filtered.push({
      driver,
      cp: String(r[kCp] ?? "").trim(),
      tipo: normalizeTipo(String(r[kTipo] ?? "")),
      fecha: kFecha ? parseDate(r[kFecha]) : "",
      contacto: kContacto ? String(r[kContacto] ?? "").trim().toLowerCase() : "",
      direccion: kDir ? String(r[kDir] ?? "").trim().toLowerCase() : "",
    });
  }

  // Detect AA: TO_DOOR rows where (driver, contacto, direccion, fecha) appears 2+ times
  const aaKey = (r: Row) => `${r.driver}|${r.contacto}|${r.direccion}|${r.fecha}`;
  const aaCount = new Map<string, number>();
  for (const r of filtered) {
    if (r.tipo === "TO_DOOR" && r.contacto && r.direccion && r.fecha) {
      aaCount.set(aaKey(r), (aaCount.get(aaKey(r)) ?? 0) + 1);
    }
  }

  // Group by driver
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
    // Aggregate by (cp, tipo)
    const agg = new Map<string, { cp: string; tipo: "TO_DOOR" | "PUDO" | "AA"; cantidad: number }>();
    const warningsSet = new Set<string>();

    for (const r of rs) {
      let effTipo: "TO_DOOR" | "PUDO" | "AA" = r.tipo;
      if (r.tipo === "TO_DOOR" && (aaCount.get(aaKey(r)) ?? 0) >= 2) {
        effTipo = "AA";
      }
      const key = `${r.cp}|${effTipo}`;
      if (!agg.has(key)) agg.set(key, { cp: r.cp, tipo: effTipo, cantidad: 0 });
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
          <header className="animate-fade-up">
            <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4 flex items-center gap-2">
              <span className="size-1 bg-electric rounded-full" /> Contabilidad
            </div>
            <h1 className="text-4xl lg:text-6xl font-syne font-extrabold leading-[0.95] text-ink tracking-tighter uppercase">
              Borradores de{" "}
              <span className="font-playfair italic font-medium text-electric normal-case tracking-normal">
                factura
              </span>
            </h1>
            <p className="mt-6 text-muted-text max-w-2xl text-[15px] leading-relaxed">
              Hub:{" "}
              <span className="text-ink font-medium">
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
        <h2 className="text-2xl font-syne font-bold text-ink tracking-tight uppercase">
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

function GeneradorSection({ hubId, hubMarca }: { hubId: string; hubMarca: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<DraftResult[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [tarifasCount, setTarifasCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase
      .from("driver_tarifas")
      .select("id", { count: "exact", head: true })
      .eq("hub_id", hubId)
      .then(({ count }) => setTarifasCount(count ?? 0));
  }, [hubId]);

  const handleFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) {
      setError("Por favor sube un archivo Excel (.xlsx)");
      return;
    }
    setError(null);
    setFile(f);
    setResults([]);
    setSavedIds(new Set());
  };

  const generate = async () => {
    if (!file) return;
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
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const res = processEpod(rows, tarifas);
      setResults(res);
      if (res.length === 0) toast.warning("No se encontraron entregas en el ePOD");
      else toast.success(`${res.length} borrador(es) generados`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error procesando el archivo";
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  const toggleExpand = (driver: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(driver)) n.delete(driver);
      else n.add(driver);
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
    if (bErr || !b) {
      toast.error(bErr?.message ?? "Error guardando borrador");
      return false;
    }
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
      if (lErr) {
        toast.error(lErr.message);
        return false;
      }
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

  const canGenerate = !!file && tarifasCount > 0 && !generating;

  return (
    <section className="animate-fade-up">
      <div className="mb-6">
        <h2 className="text-2xl font-syne font-bold text-ink tracking-tight uppercase">
          Generar borradores
        </h2>
        <p className="text-muted-text text-sm mt-1">
          Sube el ePOD y genera los borradores por driver automáticamente.
        </p>
      </div>

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
          className={`group relative border-2 border-dashed transition-colors p-10 flex flex-col items-center justify-center rounded-lg cursor-pointer ${
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
          <div className="size-12 bg-surface-2 rounded-md flex items-center justify-center mb-4 ring-1 ring-hairline">
            <Upload className="size-5 text-electric" strokeWidth={1.75} />
          </div>
          <h3 className="font-syne text-lg mb-1.5 text-ink">Cargar archivo ePOD .xlsx</h3>
          <p className="text-muted-text text-xs font-mono tracking-widest uppercase">
            Arrastra o haz click para seleccionar
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-4 p-5 bg-surface border border-hairline rounded-lg">
          <div className="size-10 bg-electric/10 border border-electric/30 rounded flex items-center justify-center shrink-0">
            <Check className="size-4 text-electric" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-sm text-ink truncate">{file.name}</div>
            <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase mt-0.5">
              LISTO PARA PROCESAR
            </div>
          </div>
          <button
            onClick={() => {
              setFile(null);
              setResults([]);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="size-8 rounded grid place-items-center text-muted-text hover:text-ink hover:bg-ink/5 transition-colors"
            aria-label="Quitar archivo"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 px-4 py-2.5 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs rounded-r flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {tarifasCount === 0 && (
        <div className="mt-3 px-4 py-2.5 border-l-2 border-amber-500 bg-amber-500/10 text-amber-700 font-mono text-xs rounded-r flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" />
          Configura al menos un CP en tarifas antes de generar.
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          onClick={generate}
          disabled={!canGenerate}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-electric text-white rounded font-mono text-xs tracking-widest uppercase hover:bg-electric/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generating ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
          Generar borradores
        </button>
      </div>

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
          <h2 className="text-2xl font-syne font-bold text-ink tracking-tight uppercase">
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
