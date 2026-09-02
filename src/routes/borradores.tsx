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
  Pencil,
  X,
} from "lucide-react";
import XLSXStyle from "xlsx-js-style";
import { toast } from "sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ESTADO_LABEL,
  ESTADO_COLOR,
  TIPO_SOLICITUD_LABEL,
  type SolicitudTarifa,
  type ValoresTarifa,
} from "@/lib/solicitudes-tarifa";
import {
  processEpodLineas,
  TIPO_LABEL,
  type Driver,
  type Tarifa,
  type DraftLine,
  type DraftResult,
  type DetalleRow,
  type EpodLineaBillingRow,
  type SituacionEspecialCalc,
} from "@/lib/facturacion-calc";

export const Route = createFileRoute("/borradores")({
  component: () => (
    <RequireAuth path="/borradores">
      <BorradoresPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Borradores" }] }),
});

// Driver/Tarifa/DraftLine/TIPO_LABEL/DraftResult/DetalleRow/EpodLineaBillingRow
// y processEpodLineas() viven en @/lib/facturacion-calc (importados arriba)
// — se extrajeron de acá para poder reusar el mismo cálculo de "lo que
// pagamos a drivers" desde el dashboard de Reconciliación de Pagos Cainiao.

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
// EXCEL EXPORT — formato "Borrador de Factura" (ItaSpain), con colores
// exactos por categoría vía xlsx-js-style (la única librería del proyecto
// que puede escribir rellenos de celda; xlsx normal no puede).
// ============================================================

const XLS_TITLE_BLUE = "2E5FA3";
const XLS_LEGEND_TODOOR = "F5F8FF";
const XLS_LEGEND_PUDO = "F3E5F5"; // PUDO 1er y PUDO Nº comparten familia morada
const XLS_DAY_SUBTOTAL = "C5D3E8";
const XLS_GRAND_TOTAL = "0D1B36";
const XLS_WHITE = "FFFFFF";
const XLS_BORDER = "D3D3D3";

const XLS_THIN_BORDER = {
  top: { style: "thin", color: { rgb: XLS_BORDER } },
  bottom: { style: "thin", color: { rgb: XLS_BORDER } },
  left: { style: "thin", color: { rgb: XLS_BORDER } },
  right: { style: "thin", color: { rgb: XLS_BORDER } },
};

const CATEGORIA_LABEL: Record<DraftLine["tipo"], string> = {
  TO_DOOR: "TO_DOOR",
  PUDO: "PUDO-1er paq",
  AA: "PUDO-Nº paq",
};

const CATEGORIA_FILL: Record<DraftLine["tipo"], string> = {
  TO_DOOR: XLS_LEGEND_TODOOR,
  PUDO: XLS_LEGEND_PUDO,
  AA: XLS_LEGEND_PUDO,
};

const DIAS_SEMANA = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const MESES_CAP = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function parseIsoDate(iso: string): Date {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y || 2000, (m || 1) - 1, day || 1);
}
function formatDDMM(iso: string): string {
  const d = parseIsoDate(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function formatDiaSeparador(iso: string): string {
  const d = parseIsoDate(iso);
  return `📅 ${DIAS_SEMANA[d.getDay()]} ${d.getDate()} DE ${MESES[d.getMonth()]}`;
}
function formatPeriodo(desde: string, hasta: string): string {
  const d1 = parseIsoDate(desde);
  const d2 = parseIsoDate(hasta);
  if (d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth()) {
    const mes = MESES_CAP[d1.getMonth()];
    const rango = d1.getDate() === d2.getDate() ? `${d1.getDate()}` : `${d1.getDate()}-${d2.getDate()}`;
    return `${mes} ${d1.getFullYear()} (${rango} ${mes})`;
  }
  return `${desde} → ${hasta}`;
}
// Varios CP pueden tener distinto precio para el mismo driver — si todos
// coinciden se muestra un único valor, si no, un rango "según CP".
function formatValores(vals: number[]): string {
  const uniq = [...new Set(vals.map((v) => v.toFixed(4)))].map(Number);
  if (uniq.length === 0) return "—";
  if (uniq.length === 1) return `${uniq[0].toFixed(2)} €`;
  const min = Math.min(...uniq);
  const max = Math.max(...uniq);
  return `según CP (${min.toFixed(2)}–${max.toFixed(2)} €)`;
}

type XlsStyle = Record<string, unknown>;

function exportBorradorFacturaExcel(d: DraftResult, hubMarca: string) {
  const aoa: (string | number)[][] = [];
  const styles: { r: number; c: number; s: XlsStyle }[] = [];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  const push = (row: (string | number)[]) => { aoa.push(row); return aoa.length - 1; };
  const style = (r: number, c: number, s: XlsStyle) => styles.push({ r, c, s });
  const styleRange = (r: number, c0: number, c1: number, s: XlsStyle) => {
    for (let c = c0; c <= c1; c++) style(r, c, s);
  };

  const bold = { font: { bold: true } };
  const titleStyle = { font: { bold: true, color: { rgb: XLS_WHITE }, sz: 13 }, fill: { patternType: "solid", fgColor: { rgb: XLS_TITLE_BLUE } }, alignment: { vertical: "center" } };
  const sectionTitleStyle = { font: { bold: true, sz: 11 } };
  const headerStyle = { font: { bold: true, color: { rgb: XLS_WHITE } }, fill: { patternType: "solid", fgColor: { rgb: XLS_TITLE_BLUE } }, alignment: { horizontal: "center", vertical: "center" }, border: XLS_THIN_BORDER };
  const daySepStyle = { font: { bold: true, color: { rgb: XLS_WHITE } }, fill: { patternType: "solid", fgColor: { rgb: XLS_TITLE_BLUE } } };
  const daySubtotalStyle = { font: { bold: true }, fill: { patternType: "solid", fgColor: { rgb: XLS_DAY_SUBTOTAL } }, border: XLS_THIN_BORDER };
  const grandTotalStyle = { font: { bold: true, color: { rgb: XLS_WHITE } }, fill: { patternType: "solid", fgColor: { rgb: XLS_GRAND_TOTAL } }, border: XLS_THIN_BORDER };
  const cellBorder = { border: XLS_THIN_BORDER };
  const legendCell = (fill: string): XlsStyle => ({ font: { bold: true, sz: 9 }, fill: { patternType: "solid", fgColor: { rgb: fill } }, alignment: { vertical: "center", wrapText: true }, border: XLS_THIN_BORDER });
  const categoriaCell = (tipo: DraftLine["tipo"]): XlsStyle => ({ fill: { patternType: "solid", fgColor: { rgb: CATEGORIA_FILL[tipo] } }, border: XLS_THIN_BORDER });

  // --- Cabecera ---
  // Filas con relleno de color sobre celdas fusionadas se rellenan a las 7
  // columnas (aunque el texto solo importa en la primera) — aoa_to_sheet
  // solo crea celdas para los índices presentes en cada fila, y sin celda no
  // hay dónde aplicar el estilo/relleno en el resto de la fusión.
  let r = push([`${hubMarca.toUpperCase()} — BORRADOR DE FACTURA`, "", "", "", "", "", ""]);
  styleRange(r, 0, 6, titleStyle);
  merges.push({ s: { r, c: 0 }, e: { r, c: 6 } });

  r = push(["Repartidor:", d.driver_nombre]);
  style(r, 0, bold);
  r = push(["Período:", formatPeriodo(d.fecha_desde, d.fecha_hasta)]);
  style(r, 0, bold);

  const doorVals = d.lineas.filter((l) => l.tipo === "TO_DOOR").map((l) => l.precio_unitario);
  const pudoVals = d.lineas.filter((l) => l.tipo === "PUDO").map((l) => l.precio_unitario);
  const aaVals = d.lineas.filter((l) => l.tipo === "AA").map((l) => l.precio_unitario);
  r = push(["Tarifa TO_DOOR:", formatValores(doorVals)]);
  style(r, 0, bold);
  r = push(["Tarifa PUDO/AA:", `1er paq. = ${formatValores(pudoVals)} · 2º+ paq. = ${formatValores(aaVals)}`]);
  style(r, 0, bold);
  r = push(["IVA:", "21%"]);
  style(r, 0, bold);
  r = push(["Total paquetes:", d.total_paquetes]);
  style(r, 0, bold);

  push([]);

  // --- Leyenda de colores ---
  r = push(["LEYENDA DE COLORES"]);
  style(r, 0, sectionTitleStyle);
  merges.push({ s: { r, c: 0 }, e: { r, c: 6 } });

  r = push(["TO_DOOR (tarifa normal)", "", "PUDO — 1er paq (tarifa normal)", "", "PUDO — 2º+ paq (tarifa extra)", "", ""]);
  style(r, 0, legendCell(XLS_LEGEND_TODOOR));
  style(r, 2, legendCell(XLS_LEGEND_PUDO));
  style(r, 4, legendCell(XLS_LEGEND_PUDO));

  push([]);

  // --- Resumen por concepto ---
  r = push(["RESUMEN POR CONCEPTO"]);
  style(r, 0, sectionTitleStyle);
  merges.push({ s: { r, c: 0 }, e: { r, c: 6 } });

  r = push(["Concepto", "Paquetes", "Tarifa", "", "Base imp.", "IVA 21%", "Total c/IVA"]);
  styleRange(r, 0, 6, headerStyle);

  const conceptOrder: DraftLine["tipo"][] = ["TO_DOOR", "PUDO", "AA"];
  const conceptVals: Record<DraftLine["tipo"], number[]> = { TO_DOOR: doorVals, PUDO: pudoVals, AA: aaVals };
  for (const tipo of conceptOrder) {
    const lineasTipo = d.lineas.filter((l) => l.tipo === tipo);
    if (lineasTipo.length === 0) continue;
    const cantidad = lineasTipo.reduce((s, l) => s + l.cantidad, 0);
    const base = lineasTipo.reduce((s, l) => s + l.subtotal, 0);
    const iva = +(base * 0.21).toFixed(2);
    r = push([CATEGORIA_LABEL[tipo], cantidad, formatValores(conceptVals[tipo]), "", +base.toFixed(2), iva, +(base + iva).toFixed(2)]);
    styleRange(r, 0, 6, cellBorder);
  }

  r = push(["", "", "", "Base imponible:", d.base_imponible, "", ""]);
  style(r, 3, bold);
  r = push(["", "", "", "IVA (21%):", "", d.iva_21, ""]);
  style(r, 3, bold);
  r = push(["TOTAL A FACTURAR", "", d.total_paquetes, "BASE + IVA:", d.base_imponible, d.iva_21, d.total]);
  styleRange(r, 0, 6, daySubtotalStyle);

  push([]);

  // --- Detalle por día ---
  if (!d.detalle || d.detalle.length === 0) {
    r = push(["DETALLE POR DÍA"]);
    style(r, 0, sectionTitleStyle);
    r = push(["Detalle por día no disponible para facturas guardadas anteriormente — vuelve a generar el borrador para incluirlo."]);
    style(r, 0, { font: { italic: true, color: { rgb: "6B7280" } } });
  } else {
    r = push(["DETALLE POR DÍA"]);
    style(r, 0, sectionTitleStyle);
    merges.push({ s: { r, c: 0 }, e: { r, c: 6 } });

    r = push(["Fecha", "Dirección", "CP", "Tipo", "Base", "IVA 21%", "Total"]);
    styleRange(r, 0, 6, headerStyle);

    const porDia = new Map<string, DetalleRow[]>();
    for (const row of d.detalle) {
      if (!porDia.has(row.fecha)) porDia.set(row.fecha, []);
      porDia.get(row.fecha)!.push(row);
    }
    const fechas = [...porDia.keys()].sort();

    let granBase = 0;
    let granIva = 0;
    for (const fecha of fechas) {
      const rowsDia = [...porDia.get(fecha)!].sort(
        (a, b) => a.direccion.localeCompare(b.direccion) || a.cp.localeCompare(b.cp),
      );

      r = push([formatDiaSeparador(fecha), "", "", "", "", "", ""]);
      styleRange(r, 0, 6, daySepStyle);
      merges.push({ s: { r, c: 0 }, e: { r, c: 6 } });

      let diaBase = 0;
      let diaIva = 0;
      for (const row of rowsDia) {
        const base = row.precio_unitario;
        const iva = base * 0.21;
        diaBase += base;
        diaIva += iva;
        r = push([
          formatDDMM(row.fecha),
          row.direccion || "—",
          row.cp || "—",
          CATEGORIA_LABEL[row.tipo],
          +base.toFixed(2),
          +iva.toFixed(2),
          +(base + iva).toFixed(2),
        ]);
        styleRange(r, 0, 6, categoriaCell(row.tipo));
      }
      granBase += diaBase;
      granIva += diaIva;

      r = push([`Total ${formatDDMM(fecha)}`, "", "", "", +diaBase.toFixed(2), +diaIva.toFixed(2), +(diaBase + diaIva).toFixed(2)]);
      styleRange(r, 0, 6, daySubtotalStyle);
    }

    r = push(["TOTAL GENERAL", "", "", "", +granBase.toFixed(2), +granIva.toFixed(2), +(granBase + granIva).toFixed(2)]);
    styleRange(r, 0, 6, grandTotalStyle);
  }

  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  ws["!cols"] = [12, 30, 12, 16, 14, 14, 14].map((wch) => ({ wch }));
  for (const { r: rr, c, s } of styles) {
    const ref = XLSXStyle.utils.encode_cell({ r: rr, c });
    const cell = (ws as Record<string, unknown>)[ref] as { s?: unknown } | undefined;
    if (cell) cell.s = s;
  }

  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, "Borrador Factura");
  const buf = XLSXStyle.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = d.driver_nombre.replace(/[^a-z0-9]+/gi, "_");
  a.download = `Borrador_${safe}_${d.fecha_desde}_${d.fecha_hasta}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ============================================================
// PAGE
// ============================================================

function BorradoresPage() {
  const { selectedHub, role, user } = useAuth();
  // jefe_flota no genera ni confirma facturas — solo puede solicitar cambios
  // de tarifa (ver TarifasSection, que se pone en "modo solicitud" para este
  // rol) y hacer seguimiento de sus propias solicitudes.
  const soloSolicita = role === "jefe_flota";

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
              <TarifasSection hubId={selectedHub.id} hubNombre={`${selectedHub.marca} · ${selectedHub.nombre}`} />
              <SituacionesEspecialesSection hubId={selectedHub.id} hubNombre={`${selectedHub.marca} · ${selectedHub.nombre}`} />
              {soloSolicita ? (
                user && <MisSolicitudesSection userId={user.id} />
              ) : (
                <>
                  <GeneradorSection hubId={selectedHub.id} hubMarca={selectedHub.marca} />
                  <SavedBorradoresSection hubId={selectedHub.id} hubMarca={selectedHub.marca} />
                </>
              )}
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

function TarifasSection({ hubId, hubNombre }: { hubId: string; hubNombre: string }) {
  const { role, user, profile } = useAuth();
  const esJefeFlota = role === "jefe_flota";
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverId, setDriverId] = useState<string>("");
  const [tarifas, setTarifas] = useState<Tarifa[]>([]);
  const [originalById, setOriginalById] = useState<Record<string, Tarifa>>({});
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dupHighlight, setDupHighlight] = useState<number | null>(null);

  const loadDrivers = async () => {
    setLoadingDrivers(true);
    const { data, error } = await supabase
      .from("drivers")
      .select("id, hub_id, nombre")
      .eq("hub_id", hubId)
      .order("nombre");
    if (error) toast.error(error.message);
    const list = (data ?? []) as Driver[];
    setDrivers(list);
    setDriverId((prev) => (list.some((d) => d.id === prev) ? prev : list[0]?.id ?? ""));
    setLoadingDrivers(false);
  };

  useEffect(() => {
    loadDrivers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubId]);

  const load = async () => {
    if (!driverId) {
      setTarifas([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("driver_tarifas")
      .select("id, hub_id, driver_id, codigo_postal, precio_door, precio_pudo, precio_aa")
      .eq("driver_id", driverId)
      .order("codigo_postal");
    if (error) toast.error(error.message);
    const mapped: Tarifa[] = (data ?? []).map((t) => ({
      id: t.id,
      hub_id: t.hub_id,
      driver_id: t.driver_id as string,
      codigo_postal: t.codigo_postal,
      precio_door: Number(t.precio_door),
      precio_pudo: Number(t.precio_pudo),
      precio_aa: Number(t.precio_aa),
    }));
    setTarifas(mapped);
    setOriginalById(Object.fromEntries(mapped.filter((t) => t.id).map((t) => [t.id as string, t])));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  // Bloquea en el momento el CP duplicado para el mismo driver, en vez de
  // dejar que se guarde y reviente el upsert con "ON CONFLICT DO UPDATE
  // command cannot affect row a second time" (el error que ya vimos). Si el
  // valor tipeado coincide con el de otra fila, no se actualiza el estado
  // (el input se queda con el valor anterior) y se resalta la fila original.
  const updateField = (idx: number, field: keyof Tarifa, value: string) => {
    if (field === "codigo_postal") {
      const normalized = value.trim();
      if (normalized) {
        const dupIdx = tarifas.findIndex((t, i) => i !== idx && t.codigo_postal.trim() === normalized);
        if (dupIdx !== -1) {
          toast.error(`El CP ${normalized} ya está configurado para este driver`);
          setDupHighlight(dupIdx);
          setTimeout(() => setDupHighlight((h) => (h === dupIdx ? null : h)), 2000);
          return;
        }
      }
    }
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
    if (!driverId) return;
    setTarifas((prev) => [
      ...prev,
      {
        hub_id: hubId,
        driver_id: driverId,
        codigo_postal: "",
        precio_door: 1.05,
        precio_pudo: 1.0,
        precio_aa: 0.2,
        _new: true,
        _dirty: true,
      },
    ]);
  };

  const removeRow = async (idx: number) => {
    const t = tarifas[idx];
    if (t.id) {
      if (esJefeFlota) {
        toast.error("Los jefes de flota no pueden eliminar tarifas directo — solo solicitar cambios de precio.");
        return;
      }
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
    if (!driverId) return;
    setSaving(true);
    const dirty = tarifas.filter((t) => t._dirty && t.codigo_postal.trim());
    if (dirty.length === 0) {
      toast.info("No hay cambios pendientes");
      setSaving(false);
      return;
    }
    // Red de seguridad: aunque updateField ya bloquea CPs duplicados al
    // tipear, se deduplica igual por (driver_id, codigo_postal) antes de
    // mandar el upsert — si llegara a colarse un duplicado, Postgres tira
    // "ON CONFLICT DO UPDATE command cannot affect row a second time"
    // porque el mismo lote intentaría afectar la misma fila dos veces. Se
    // conserva la última fila (la más reciente en el array).
    const byCp = new Map<string, Tarifa>();
    for (const t of dirty) byCp.set(t.codigo_postal.trim(), t);
    const deduped = [...byCp.values()];

    if (esJefeFlota) {
      if (!user) { setSaving(false); return; }
      const driverNombre = drivers.find((d) => d.id === driverId)?.nombre ?? "";
      const actorNombre = profile?.full_name?.trim() || user.email || "—";
      const rows = deduped.map((t) => {
        const original = t.id ? originalById[t.id] : undefined;
        return {
          hub_id: hubId,
          hub_nombre: hubNombre,
          driver_id: driverId,
          driver_nombre: driverNombre,
          tipo: "tarifa_normal" as const,
          codigo_postal: t.codigo_postal.trim(),
          solicitado_por: user.id,
          solicitado_por_nombre: actorNombre,
          valores_propuestos: {
            tarifa_to_door: t.precio_door,
            tarifa_pudo_primero: t.precio_pudo,
            tarifa_pudo_extra: t.precio_aa,
          },
          valores_anteriores: original
            ? {
                tarifa_to_door: original.precio_door,
                tarifa_pudo_primero: original.precio_pudo,
                tarifa_pudo_extra: original.precio_aa,
              }
            : null,
        };
      });
      const { error } = await supabase.from("solicitudes_tarifa").insert(rows);
      if (error) {
        toast.error(error.message);
      } else {
        toast.success(`${rows.length} solicitud(es) enviada(s) a Manager para aprobación`);
        setTarifas((prev) => prev.map((t) => (t._dirty ? { ...t, _dirty: false } : t)));
      }
      setSaving(false);
      return;
    }

    const payload = deduped.map((t) => ({
      ...(t.id ? { id: t.id } : {}),
      hub_id: hubId,
      driver_id: driverId,
      codigo_postal: t.codigo_postal.trim(),
      precio_door: t.precio_door,
      precio_pudo: t.precio_pudo,
      precio_aa: t.precio_aa,
    }));
    const { error } = await supabase
      .from("driver_tarifas")
      .upsert(payload, { onConflict: "driver_id,codigo_postal" });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`${deduped.length} tarifa(s) guardadas`);
      await load();
    }
    setSaving(false);
  };

  return (
    <section className="animate-fade-up">
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Tarifas por CP y driver
          </h2>
          <p className="text-muted-text text-sm mt-1">
            Cada driver tiene su propio precio por código postal. Gestiona los drivers en{" "}
            <Link to="/drivers" className="text-electric hover:underline">/drivers</Link>.
          </p>
          {esJefeFlota && (
            <p className="text-amber-700 text-xs mt-1.5 font-mono">
              Como Jefe de Flota, tus cambios se envían como solicitud y requieren aprobación de Manager → Jefe Contable → Admin antes de aplicarse.
            </p>
          )}
        </div>
        <select
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
          disabled={loadingDrivers || drivers.length === 0}
          className="border border-hairline rounded px-3 py-2 text-sm bg-background font-mono min-w-[220px]"
        >
          {drivers.length === 0 && <option value="">Sin drivers</option>}
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>{d.nombre}</option>
          ))}
        </select>
      </div>

      {!loadingDrivers && drivers.length === 0 ? (
        <div className="px-4 py-6 border-l-2 border-amber-500 bg-amber-500/10 text-amber-700 font-mono text-xs rounded-r">
          No hay drivers creados para este hub. <Link to="/drivers" className="underline">Crea un driver</Link> antes de configurar tarifas.
        </div>
      ) : (
        <div className="bg-surface border border-hairline rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 border-b border-hairline font-mono text-[10px] tracking-widest uppercase text-muted-text">
                  <th className="text-left px-4 py-3">Código Postal</th>
                  <th className="text-right px-4 py-3">TO_DOOR (€)</th>
                  <th className="text-right px-4 py-3">PUDO · 1º del día (€)</th>
                  <th className="text-right px-4 py-3">PUDO · extra mismo punto (€)</th>
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
                      Sin tarifas configuradas para este driver
                    </td>
                  </tr>
                ) : (
                  tarifas.map((t, idx) => (
                    <tr
                      key={t.id ?? `new-${idx}`}
                      className={`border-b border-hairline/50 transition-colors ${
                        dupHighlight === idx
                          ? "bg-danger/10 ring-1 ring-inset ring-danger/50"
                          : t._dirty
                            ? "bg-electric/5"
                            : ""
                      }`}
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
              disabled={!driverId}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-widest uppercase text-ink hover:text-electric transition-colors disabled:opacity-50"
            >
              <Plus className="size-3.5" /> Añadir CP
            </button>
            <button
              onClick={saveAll}
              disabled={saving || !driverId}
              className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded font-mono text-xs tracking-widest uppercase hover:bg-electric transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {esJefeFlota ? "Enviar solicitud" : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================================
// SECTION 1B: MIS SOLICITUDES (jefe_flota)
// ============================================================

const CAMPO_LABEL_SOLICITUD: Record<keyof ValoresTarifa, string> = {
  tarifa_to_door: "TO_DOOR",
  tarifa_pudo_primero: "PUDO 1º",
  tarifa_pudo_extra: "PUDO extra",
  precio_salida: "Salida",
  nota: "Nota",
};

function fmtValor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toString();
  return String(v);
}

function MisSolicitudesSection({ userId }: { userId: string }) {
  const [items, setItems] = useState<SolicitudTarifa[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("solicitudes_tarifa")
      .select("*")
      .eq("solicitado_por", userId)
      .order("solicitado_en", { ascending: false });
    if (error) toast.error(error.message);
    setItems((data ?? []) as SolicitudTarifa[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <section className="animate-fade-up">
      <div className="mb-6">
        <h2 className="text-base font-semibold tracking-tight text-foreground">Mis solicitudes</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Cambios de tarifa que enviaste, con la etapa de aprobación en la que están.
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-xs">Cargando…</p>
      ) : items.length === 0 ? (
        <Card className="shadow-none">
          <CardContent className="py-6 text-sm text-muted-foreground">
            Todavía no enviaste ninguna solicitud de cambio de tarifa.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((s) => (
            <Card key={s.id} className="shadow-none">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {s.driver_nombre} <span className="text-muted-foreground font-normal">· CP {s.codigo_postal}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {TIPO_SOLICITUD_LABEL[s.tipo]}
                      {s.fecha ? ` · ${s.fecha}` : ""} · Enviada {new Date(s.solicitado_en).toLocaleString("es-ES")}
                    </p>
                    <p className="text-xs text-foreground mt-2">
                      {(Object.keys(s.valores_propuestos) as (keyof ValoresTarifa)[])
                        .filter((c) => s.valores_propuestos[c] !== null && s.valores_propuestos[c] !== undefined)
                        .map((c) => `${CAMPO_LABEL_SOLICITUD[c]}: ${fmtValor(s.valores_propuestos[c])}`)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className={`shrink-0 px-2 py-1 rounded border text-[10px] uppercase tracking-wide ${ESTADO_COLOR[s.estado]}`}>
                    {ESTADO_LABEL[s.estado]}
                  </span>
                </div>
                {s.estado === "rechazado" && (
                  <div className="mt-3 px-3 py-2 rounded border-l-2 border-destructive bg-destructive/10 text-xs">
                    <p className="text-destructive font-medium">
                      Rechazado por {s.rechazado_nombre} (etapa {s.rechazado_en_etapa})
                    </p>
                    {s.motivo_rechazo && <p className="text-foreground mt-1">{s.motivo_rechazo}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================
// SECTION 1B: SITUACIONES ESPECIALES
// ============================================================

type SituacionEspecial = {
  id: string;
  driver_id: string;
  driver_nombre: string;
  hub_id: string;
  fecha: string;
  codigo_postal: string;
  tarifa_to_door: number | null;
  tarifa_pudo_primero: number | null;
  tarifa_pudo_extra: number | null;
  precio_salida: number | null;
  nota: string | null;
};

function parseOpcional(s: string): number | null {
  const t = s.trim();
  return t === "" ? null : Number(t);
}

function SituacionesEspecialesSection({ hubId, hubNombre }: { hubId: string; hubNombre: string }) {
  const { role, user, profile } = useAuth();
  const esJefeFlota = role === "jefe_flota";

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [items, setItems] = useState<SituacionEspecial[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [filterDriverId, setFilterDriverId] = useState<string>("todos");
  const [filterDesde, setFilterDesde] = useState<string>("");
  const [filterHasta, setFilterHasta] = useState<string>("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDriverId, setFormDriverId] = useState("");
  const [formFecha, setFormFecha] = useState(() => isoToday());
  const [formCp, setFormCp] = useState("");
  const [formToDoor, setFormToDoor] = useState("");
  const [formPudo1, setFormPudo1] = useState("");
  const [formPudoExtra, setFormPudoExtra] = useState("");
  const [formSalida, setFormSalida] = useState("");
  const [formNota, setFormNota] = useState("");

  const loadDrivers = async () => {
    const { data, error } = await supabase
      .from("drivers")
      .select("id, hub_id, nombre")
      .eq("hub_id", hubId)
      .order("nombre");
    if (error) toast.error(error.message);
    const list = (data ?? []) as Driver[];
    setDrivers(list);
    setFormDriverId((prev) => (list.some((d) => d.id === prev) ? prev : list[0]?.id ?? ""));
  };

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("situaciones_especiales")
      .select(
        "id, driver_id, hub_id, fecha, codigo_postal, tarifa_to_door, tarifa_pudo_primero, tarifa_pudo_extra, precio_salida, nota, driver:drivers(nombre)",
      )
      .eq("hub_id", hubId)
      .order("fecha", { ascending: false });
    if (error) toast.error(error.message);
    const mapped: SituacionEspecial[] = ((data ?? []) as unknown as Array<{
      id: string;
      driver_id: string;
      hub_id: string;
      fecha: string;
      codigo_postal: string;
      tarifa_to_door: number | null;
      tarifa_pudo_primero: number | null;
      tarifa_pudo_extra: number | null;
      precio_salida: number | null;
      nota: string | null;
      driver: { nombre: string } | null;
    }>).map((r) => ({
      id: r.id,
      driver_id: r.driver_id,
      driver_nombre: r.driver?.nombre ?? "—",
      hub_id: r.hub_id,
      fecha: r.fecha,
      codigo_postal: r.codigo_postal,
      tarifa_to_door: r.tarifa_to_door,
      tarifa_pudo_primero: r.tarifa_pudo_primero,
      tarifa_pudo_extra: r.tarifa_pudo_extra,
      precio_salida: r.precio_salida,
      nota: r.nota,
    }));
    setItems(mapped);
    setLoading(false);
  };

  useEffect(() => {
    void loadDrivers();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubId]);

  const filtered = items.filter((i) => {
    if (filterDriverId !== "todos" && i.driver_id !== filterDriverId) return false;
    if (filterDesde && i.fecha < filterDesde) return false;
    if (filterHasta && i.fecha > filterHasta) return false;
    return true;
  });

  const resetForm = () => {
    setEditingId(null);
    setFormFecha(isoToday());
    setFormCp("");
    setFormToDoor("");
    setFormPudo1("");
    setFormPudoExtra("");
    setFormSalida("");
    setFormNota("");
  };

  const startEdit = (item: SituacionEspecial) => {
    setEditingId(item.id);
    setFormDriverId(item.driver_id);
    setFormFecha(item.fecha);
    setFormCp(item.codigo_postal);
    setFormToDoor(item.tarifa_to_door?.toString() ?? "");
    setFormPudo1(item.tarifa_pudo_primero?.toString() ?? "");
    setFormPudoExtra(item.tarifa_pudo_extra?.toString() ?? "");
    setFormSalida(item.precio_salida?.toString() ?? "");
    setFormNota(item.nota ?? "");
  };

  const submit = async () => {
    if (!formDriverId || !formFecha || !formCp.trim()) {
      toast.error("Completa driver, fecha y CP");
      return;
    }
    setSaving(true);
    const valores: ValoresTarifa = {
      tarifa_to_door: parseOpcional(formToDoor),
      tarifa_pudo_primero: parseOpcional(formPudo1),
      tarifa_pudo_extra: parseOpcional(formPudoExtra),
      precio_salida: parseOpcional(formSalida),
      nota: formNota.trim() || null,
    };

    if (esJefeFlota) {
      if (!user) { setSaving(false); return; }
      const driverNombre = drivers.find((d) => d.id === formDriverId)?.nombre ?? "";
      const actorNombre = profile?.full_name?.trim() || user.email || "—";
      const editingItem = editingId ? items.find((i) => i.id === editingId) : null;
      const valoresAnteriores: ValoresTarifa | null = editingItem
        ? {
            tarifa_to_door: editingItem.tarifa_to_door,
            tarifa_pudo_primero: editingItem.tarifa_pudo_primero,
            tarifa_pudo_extra: editingItem.tarifa_pudo_extra,
            precio_salida: editingItem.precio_salida,
            nota: editingItem.nota,
          }
        : null;
      const { error } = await supabase.from("solicitudes_tarifa").insert({
        hub_id: hubId,
        hub_nombre: hubNombre,
        driver_id: formDriverId,
        driver_nombre: driverNombre,
        tipo: "situacion_especial",
        codigo_postal: formCp.trim(),
        fecha: formFecha,
        solicitado_por: user.id,
        solicitado_por_nombre: actorNombre,
        valores_propuestos: valores,
        valores_anteriores: valoresAnteriores,
      });
      if (error) toast.error(error.message);
      else {
        toast.success(`Solicitud enviada a Manager para aprobación`);
        resetForm();
      }
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("situaciones_especiales").upsert(
      {
        ...(editingId ? { id: editingId } : {}),
        driver_id: formDriverId,
        hub_id: hubId,
        fecha: formFecha,
        codigo_postal: formCp.trim(),
        tarifa_to_door: valores.tarifa_to_door,
        tarifa_pudo_primero: valores.tarifa_pudo_primero,
        tarifa_pudo_extra: valores.tarifa_pudo_extra,
        precio_salida: valores.precio_salida,
        nota: valores.nota,
      },
      { onConflict: "driver_id,fecha,codigo_postal" },
    );
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(editingId ? "Situación especial actualizada" : "Situación especial creada");
      resetForm();
      await load();
    }
    setSaving(false);
  };

  const remove = async (item: SituacionEspecial) => {
    if (esJefeFlota) {
      toast.error("Los jefes de flota no pueden eliminar situaciones especiales directo — pedile a un Manager o Admin.");
      return;
    }
    if (!confirm(`¿Eliminar la situación especial de ${item.driver_nombre} el ${item.fecha} (CP ${item.codigo_postal})?`)) return;
    const { error } = await supabase.from("situaciones_especiales").delete().eq("id", item.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Situación especial eliminada");
      if (editingId === item.id) resetForm();
      await load();
    }
  };

  return (
    <section className="animate-fade-up space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">Situaciones especiales</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Tarifa puntual para un driver en una fecha y CP concretos — sobreescribe la tarifa normal solo ese día.
          {esJefeFlota && " Los cambios se envían como solicitud de aprobación."}
        </p>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">
            {editingId ? "Editar situación especial" : "Nueva situación especial"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FieldSE label="Driver">
              <select
                value={formDriverId}
                onChange={(e) => setFormDriverId(e.target.value)}
                disabled={drivers.length === 0 || !!editingId}
                className="w-full appearance-none pl-3 pr-8 py-2 text-sm bg-card border rounded-md text-foreground disabled:opacity-60"
              >
                {drivers.length === 0 && <option value="">Sin drivers</option>}
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.nombre}</option>
                ))}
              </select>
            </FieldSE>
            <FieldSE label="Fecha">
              <Input type="date" value={formFecha} onChange={(e) => setFormFecha(e.target.value)} disabled={!!editingId} />
            </FieldSE>
            <FieldSE label="Código postal">
              <Input value={formCp} onChange={(e) => setFormCp(e.target.value)} disabled={!!editingId} placeholder="28001" />
            </FieldSE>
            <FieldSE label="Tarifa TO_DOOR (€) · opcional">
              <Input type="number" step="0.0001" value={formToDoor} onChange={(e) => setFormToDoor(e.target.value)} placeholder="Normal del driver" />
            </FieldSE>
            <FieldSE label="Tarifa PUDO 1º (€) · opcional">
              <Input type="number" step="0.0001" value={formPudo1} onChange={(e) => setFormPudo1(e.target.value)} placeholder="Normal del driver" />
            </FieldSE>
            <FieldSE label="Tarifa PUDO extra (€) · opcional">
              <Input type="number" step="0.0001" value={formPudoExtra} onChange={(e) => setFormPudoExtra(e.target.value)} placeholder="Normal del driver" />
            </FieldSE>
            <FieldSE label="Precio de salida (€) · opcional">
              <Input type="number" step="0.01" value={formSalida} onChange={(e) => setFormSalida(e.target.value)} placeholder="Pago fijo extra ese día" />
            </FieldSE>
            <div className="sm:col-span-2 md:col-span-3">
              <FieldSE label="Nota">
                <Textarea value={formNota} onChange={(e) => setFormNota(e.target.value)} rows={2} placeholder="Ej. Apoyo a Yenifer, ruta 3680" />
              </FieldSE>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            {editingId && (
              <Button variant="outline" onClick={resetForm} disabled={saving}>
                <X className="size-3.5" /> Cancelar edición
              </Button>
            )}
            <Button onClick={submit} disabled={saving || !formDriverId} className="gap-2 bg-ink hover:bg-ink/90">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {esJefeFlota ? "Enviar solicitud" : editingId ? "Guardar cambios" : "Crear situación especial"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none overflow-hidden">
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-sm font-semibold">Situaciones especiales vigentes</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={filterDriverId}
                onChange={(e) => setFilterDriverId(e.target.value)}
                className="appearance-none pl-3 pr-8 py-1.5 text-xs bg-card border rounded-md text-foreground"
              >
                <option value="todos">Todos los drivers</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.nombre}</option>
                ))}
              </select>
              <Input type="date" value={filterDesde} onChange={(e) => setFilterDesde(e.target.value)} className="w-[150px]" />
              <span className="text-muted-foreground text-xs">a</span>
              <Input type="date" value={filterHasta} onChange={(e) => setFilterHasta(e.target.value)} className="w-[150px]" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted">
                  <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Fecha</th>
                  <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Driver</th>
                  <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">CP</th>
                  <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">TO_DOOR</th>
                  <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">PUDO 1º</th>
                  <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">PUDO extra</th>
                  <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Salida</th>
                  <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Nota</th>
                  <th className="px-4 py-2.5 w-20" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-xs">Cargando…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-xs">Sin situaciones especiales para este filtro</td></tr>
                ) : (
                  filtered.map((item) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="px-4 py-2 text-foreground whitespace-nowrap">{item.fecha}</td>
                      <td className="px-4 py-2 text-foreground">{item.driver_nombre}</td>
                      <td className="px-4 py-2 text-foreground">{item.codigo_postal}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-foreground">{item.tarifa_to_door ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-foreground">{item.tarifa_pudo_primero ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-foreground">{item.tarifa_pudo_extra ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-foreground">{item.precio_salida ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground max-w-[200px] truncate" title={item.nota ?? ""}>{item.nota ?? "—"}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => startEdit(item)} aria-label="Editar">
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void remove(item)}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label="Eliminar"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function FieldSE({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">{label}</span>
      {children}
    </label>
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
  const [driversCount, setDriversCount] = useState(0);
  const [tarifasCount, setTarifasCount] = useState(0);
  const [periodCount, setPeriodCount] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("drivers")
      .select("id", { count: "exact", head: true })
      .eq("hub_id", hubId)
      .then(({ count }) => setDriversCount(count ?? 0));
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
        .from("epod_lineas")
        .select("id", { count: "exact", head: true })
        .eq("hub_id", hubId)
        .gte("fecha", fromDate)
        .lte("fecha", toDate);
      if (!cancelled) setPeriodCount(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [hubId, fromDate, toDate]);

  // Paginación en paralelo (conteo primero + Promise.all de todas las
  // páginas) en vez de un loop secuencial de awaits — mismo patrón ya usado
  // en Mapa de Entregas, mucho más rápido para hubs con miles de paquetes.
  const PAGE_SIZE = 1000;
  const fetchEpodLineas = async (): Promise<EpodLineaBillingRow[]> => {
    const { count, error: countErr } = await supabase
      .from("epod_lineas")
      .select("id", { count: "exact", head: true })
      .eq("hub_id", hubId)
      .gte("fecha", fromDate)
      .lte("fecha", toDate);
    if (countErr) throw countErr;
    const total = count ?? 0;
    const pageCount = Math.ceil(total / PAGE_SIZE);
    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, i) => {
        const from = i * PAGE_SIZE;
        return supabase
          .from("epod_lineas")
          .select("lp_no, driver, fecha, cp, direccion, tipo_norm, pop_station_id")
          .eq("hub_id", hubId)
          .gte("fecha", fromDate)
          .lte("fecha", toDate)
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
      }),
    );
    const all: EpodLineaBillingRow[] = [];
    for (const { data, error: qErr } of pages) {
      if (qErr) throw qErr;
      all.push(...((data ?? []) as EpodLineaBillingRow[]));
    }
    return all;
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const [{ data: driversData, error: dErr }, { data: tarifasData, error: tErr }, { data: situacionesData, error: sErr }] = await Promise.all([
        supabase.from("drivers").select("id, hub_id, nombre").eq("hub_id", hubId),
        supabase
          .from("driver_tarifas")
          .select("id, hub_id, driver_id, codigo_postal, precio_door, precio_pudo, precio_aa")
          .eq("hub_id", hubId)
          .not("driver_id", "is", null),
        supabase
          .from("situaciones_especiales")
          .select("driver_id, fecha, codigo_postal, tarifa_to_door, tarifa_pudo_primero, tarifa_pudo_extra, precio_salida")
          .eq("hub_id", hubId)
          .gte("fecha", fromDate)
          .lte("fecha", toDate),
      ]);
      if (dErr) throw dErr;
      if (tErr) throw tErr;
      if (sErr) throw sErr;
      const drivers = (driversData ?? []) as Driver[];
      const tarifas: Tarifa[] = (tarifasData ?? []).map((t) => ({
        id: t.id,
        hub_id: t.hub_id,
        driver_id: t.driver_id as string,
        codigo_postal: t.codigo_postal,
        precio_door: Number(t.precio_door),
        precio_pudo: Number(t.precio_pudo),
        precio_aa: Number(t.precio_aa),
      }));
      const situaciones: SituacionEspecialCalc[] = (situacionesData ?? []).map((s) => ({
        driver_id: s.driver_id,
        fecha: s.fecha,
        codigo_postal: s.codigo_postal,
        tarifa_to_door: s.tarifa_to_door,
        tarifa_pudo_primero: s.tarifa_pudo_primero,
        tarifa_pudo_extra: s.tarifa_pudo_extra,
        precio_salida: s.precio_salida,
      }));
      const rows = await fetchEpodLineas();
      const res = processEpodLineas(rows, tarifas, drivers, situaciones);
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
    if (!d.driver_id) {
      toast.error(`"${d.driver_nombre}" no está registrado en /drivers — no se puede guardar`);
      return false;
    }
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
    let skipped = 0;
    for (const d of results) {
      if (savedIds.has(d.driver_nombre)) continue;
      if (!d.driver_id) { skipped++; continue; }
      if (await saveBorrador(d)) ok++;
    }
    if (ok > 0) toast.success(`${ok} borrador(es) guardados`);
    if (skipped > 0) toast.warning(`${skipped} driver(es) sin registrar en /drivers, no se guardaron`);
  };

  const downloadAll = () => results.forEach((d) => exportBorradorFacturaExcel(d, hubMarca));

  const hasData = (periodCount ?? 0) > 0;
  const canGenerate = hasData && driversCount > 0 && tarifasCount > 0 && !generating;

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

      {driversCount === 0 ? (
        <div className="mt-3 px-4 py-2.5 border-l-2 border-amber-500 bg-amber-500/10 text-amber-700 font-mono text-xs rounded-r flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" />
          Crea al menos un <Link to="/drivers" className="underline">driver</Link> antes de generar.
        </div>
      ) : tarifasCount === 0 && (
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
            const unregistered = !d.driver_id;
            return (
              <article
                key={d.driver_nombre}
                className={`bg-surface border rounded-lg overflow-hidden ${unregistered ? "border-danger/40" : "border-hairline"}`}
              >
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer hover:bg-surface-2 transition-colors"
                  onClick={() => toggleExpand(d.driver_nombre)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-syne font-bold text-ink text-base flex items-center gap-2">
                      {d.driver_nombre}
                      {unregistered && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-danger/30 bg-danger/10 text-danger font-mono text-[9px] uppercase tracking-widest">
                          No registrado
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] tracking-widest text-muted-text uppercase mt-0.5">
                      {d.total_paquetes} paquetes · {d.fecha_desde} → {d.fecha_hasta}
                    </div>
                  </div>
                  <div className="font-playfair italic font-medium text-electric text-2xl tabular-nums">
                    {unregistered ? "—" : d.total.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
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
                            <td className="px-5 py-1.5 font-mono text-xs">{TIPO_LABEL[l.tipo]}</td>
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
                        onClick={() => exportBorradorFacturaExcel(d, hubMarca)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-widest uppercase border border-hairline rounded hover:border-electric hover:text-electric transition-colors"
                      >
                        <Download className="size-3.5" /> Excel
                      </button>
                      <button
                        onClick={() => saveOne(d)}
                        disabled={saved || unregistered}
                        title={unregistered ? "Registra este driver en /drivers antes de guardar" : undefined}
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
      driver_id: null,
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
    exportBorradorFacturaExcel(draft, hubMarca);
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
