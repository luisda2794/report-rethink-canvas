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
import XLSXStyle from "xlsx-js-style";
import { toast } from "sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  ESTADO_LABEL,
  ESTADO_COLOR,
  type SolicitudTarifa,
  type ValoresTarifa,
} from "@/lib/solicitudes-tarifa";

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

type Driver = {
  id: string;
  hub_id: string;
  nombre: string;
};

type Tarifa = {
  id?: string;
  hub_id: string;
  driver_id: string;
  codigo_postal: string;
  precio_door: number;
  precio_pudo: number;
  precio_aa: number;
  _dirty?: boolean;
  _new?: boolean;
};

// "AA" es internamente el mismo nombre que ya usaba driver_tarifas.precio_aa,
// pero cambió de significado: antes era el 2º+ intento TO_DOOR a la misma
// dirección; ahora es el modelo PUDO por punto/día (1er paquete del día en un
// pop_station_id = PUDO, los siguientes al mismo punto/día = AA). Se muestra
// con TIPO_LABEL para no confundir con el modelo viejo.
type DraftLine = {
  cp: string;
  tipo: "TO_DOOR" | "PUDO" | "AA";
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
};

const TIPO_LABEL: Record<DraftLine["tipo"], string> = {
  TO_DOOR: "TO_DOOR",
  PUDO: "PUDO (1º del día)",
  AA: "PUDO (extra, mismo punto/día)",
};

type DraftResult = {
  driver_nombre: string;
  driver_id: string | null;
  total_paquetes: number;
  base_imponible: number;
  iva_21: number;
  total: number;
  fecha_desde: string;
  fecha_hasta: string;
  lineas: DraftLine[];
  warnings: string[];
  detalle?: DetalleRow[];
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
// EPOD_LINEAS PROCESSING (from Supabase)
// ============================================================

type EpodLineaBillingRow = {
  lp_no: string;
  driver: string | null;
  fecha: string | null;
  cp: string | null;
  direccion: string | null;
  tipo_norm: string | null;
  pop_station_id: string | null;
};

// Una fila por paquete facturado, con lo necesario para armar la sección
// "Detalle por día" del Excel — se calcula además del agregado por CP+tipo
// (DraftResult.lineas) que ya se usaba para la vista en pantalla y el guardado
// en borradores/borrador_lineas (eso no cambia). Solo existe para resultados
// recién generados: un borrador ya guardado en la base no tiene este nivel de
// detalle (borrador_lineas solo guarda el agregado), así que el Excel de un
// borrador guardado no puede reconstruir el detalle por día.
type DetalleRow = {
  fecha: string;
  direccion: string;
  cp: string;
  tipo: DraftLine["tipo"];
  precio_unitario: number;
};

function normalizeName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// Modelo AA (PUDO): dentro de un mismo driver+CP, se agrupan los paquetes
// PUDO por (pop_station_id, fecha) — el primero del grupo se factura a
// precio_pudo, el resto del mismo punto el mismo día a precio_aa (más
// barato). Si un paquete PUDO no trae pop_station_id no hay forma de saber
// si comparte punto con otro, así que se factura individualmente a
// precio_pudo (el precio lleno) en vez de asumir un agrupamiento — y se
// marca con un warning para que quede visible, no oculto.
function processEpodLineas(
  rows: EpodLineaBillingRow[],
  tarifas: Tarifa[],
  drivers: Driver[],
): DraftResult[] {
  if (rows.length === 0) return [];

  const tarifaByDriverCp = new Map(
    tarifas.map((t) => [`${t.driver_id}|${t.codigo_postal.trim()}`, t]),
  );
  const driverByName = new Map(drivers.map((d) => [normalizeName(d.nombre), d]));

  type Row = {
    driverKey: string;
    driverNombre: string;
    driverId: string | null;
    cp: string;
    direccion: string;
    tipo: "PUDO" | "TO_DOOR";
    fecha: string;
    popStationId: string;
    lp: string;
  };
  const filtered: Row[] = [];
  for (const r of rows) {
    const rawDriver = (r.driver ?? "").split(" | ")[0].trim();
    if (!rawDriver) continue;
    const match = driverByName.get(normalizeName(rawDriver));
    filtered.push({
      driverKey: match ? `id:${match.id}` : `name:${normalizeName(rawDriver)}`,
      driverNombre: match ? match.nombre : rawDriver,
      driverId: match ? match.id : null,
      cp: (r.cp ?? "").trim(),
      direccion: (r.direccion ?? "").trim(),
      tipo: (r.tipo_norm ?? "").trim().toUpperCase() === "PUDO" ? "PUDO" : "TO_DOOR",
      fecha: r.fecha ?? "",
      popStationId: (r.pop_station_id ?? "").trim(),
      lp: r.lp_no,
    });
  }

  const byDriver = new Map<string, Row[]>();
  for (const r of filtered) {
    if (!byDriver.has(r.driverKey)) byDriver.set(r.driverKey, []);
    byDriver.get(r.driverKey)!.push(r);
  }

  const dates = filtered.map((r) => r.fecha).filter(Boolean).sort();
  const fecha_desde = dates[0] || new Date().toISOString().slice(0, 10);
  const fecha_hasta = dates[dates.length - 1] || fecha_desde;

  const results: DraftResult[] = [];
  for (const [, rs] of byDriver) {
    const driverId = rs[0].driverId;
    const driverNombre = rs[0].driverNombre;
    const warningsSet = new Set<string>();

    if (!driverId) {
      // Sin driver registrado en /drivers: no hay driver_id con el que
      // buscar tarifa, así que no se puede calcular nada — se deja
      // explícito en vez de omitir o cobrar 0€ silenciosamente.
      warningsSet.add(`"${driverNombre}" no está registrado en /drivers — crea el driver para poder facturarlo`);
      const cpSet = new Set(rs.map((r) => r.cp || "—"));
      const lineas: DraftLine[] = [...cpSet].map((cp) => ({
        cp,
        tipo: "TO_DOOR" as const,
        cantidad: rs.filter((r) => (r.cp || "—") === cp).length,
        precio_unitario: 0,
        subtotal: 0,
      }));
      results.push({
        driver_nombre: driverNombre,
        driver_id: null,
        total_paquetes: rs.length,
        base_imponible: 0,
        iva_21: 0,
        total: 0,
        fecha_desde,
        fecha_hasta,
        lineas,
        warnings: [...warningsSet],
      });
      continue;
    }

    // TO_DOOR: cantidad simple por CP.
    const doorAgg = new Map<string, number>();
    for (const r of rs) {
      if (r.tipo !== "TO_DOOR") continue;
      doorAgg.set(r.cp, (doorAgg.get(r.cp) ?? 0) + 1);
    }

    // PUDO: agrupar por (pop_station_id, fecha) para aplicar el modelo AA.
    const pudoGroups = new Map<string, Row[]>();
    let ungroupedPudo = 0;
    for (const r of rs) {
      if (r.tipo !== "PUDO") continue;
      if (!r.popStationId) {
        ungroupedPudo++;
        const soloKey = `__solo__${r.lp}`;
        pudoGroups.set(soloKey, [r]);
        continue;
      }
      const key = `${r.popStationId}|${r.fecha}`;
      if (!pudoGroups.has(key)) pudoGroups.set(key, []);
      pudoGroups.get(key)!.push(r);
    }
    if (ungroupedPudo > 0) {
      warningsSet.add(`${ungroupedPudo} paquete(s) PUDO sin punto de recogida identificado — facturados a precio de 1º`);
    }
    const pudoAgg = new Map<string, number>(); // cp -> cantidad a precio_pudo
    const aaAgg = new Map<string, number>(); // cp -> cantidad a precio_aa
    for (const group of pudoGroups.values()) {
      const cp = group[0].cp;
      pudoAgg.set(cp, (pudoAgg.get(cp) ?? 0) + 1);
      if (group.length > 1) {
        aaAgg.set(cp, (aaAgg.get(cp) ?? 0) + (group.length - 1));
      }
    }

    const priceFor = (cp: string, tipo: DraftLine["tipo"]): number | null => {
      const tar = tarifaByDriverCp.get(`${driverId}|${cp}`);
      if (!tar) return null;
      return tipo === "PUDO" ? Number(tar.precio_pudo) : tipo === "AA" ? Number(tar.precio_aa) : Number(tar.precio_door);
    };

    const lineas: DraftLine[] = [];
    let base = 0;
    let total_paquetes = 0;
    const cpsWithoutTarifa = new Set<string>();
    const pushLinea = (cp: string, tipo: DraftLine["tipo"], cantidad: number) => {
      if (cantidad <= 0) return;
      const precio = priceFor(cp, tipo);
      if (precio === null) cpsWithoutTarifa.add(cp || "(sin CP)");
      const p = precio ?? 0;
      const subtotal = +(cantidad * p).toFixed(2);
      lineas.push({ cp: cp || "(sin CP)", tipo, cantidad, precio_unitario: p, subtotal });
      base += subtotal;
      total_paquetes += cantidad;
    };
    for (const [cp, cantidad] of doorAgg) pushLinea(cp, "TO_DOOR", cantidad);
    for (const [cp, cantidad] of pudoAgg) pushLinea(cp, "PUDO", cantidad);
    for (const [cp, cantidad] of aaAgg) pushLinea(cp, "AA", cantidad);
    for (const cp of cpsWithoutTarifa) warningsSet.add(`CP ${cp} sin tarifa configurada para ${driverNombre}`);

    lineas.sort((a, b) => a.cp.localeCompare(b.cp) || a.tipo.localeCompare(b.tipo));
    base = +base.toFixed(2);
    const iva_21 = +(base * 0.21).toFixed(2);
    const total = +(base + iva_21).toFixed(2);

    // Detalle por paquete (para la sección "Detalle por día" del Excel) —
    // misma clasificación TO_DOOR/PUDO-1º/PUDO-Nº que ya se usó arriba para
    // el agregado, pero sin agregar: una fila por paquete.
    const detalle: DetalleRow[] = [];
    for (const r of rs) {
      if (r.tipo !== "TO_DOOR") continue;
      detalle.push({ fecha: r.fecha, direccion: r.direccion, cp: r.cp, tipo: "TO_DOOR", precio_unitario: priceFor(r.cp, "TO_DOOR") ?? 0 });
    }
    for (const group of pudoGroups.values()) {
      group.forEach((r, i) => {
        const tipo: DraftLine["tipo"] = i === 0 ? "PUDO" : "AA";
        detalle.push({ fecha: r.fecha, direccion: r.direccion, cp: r.cp, tipo, precio_unitario: priceFor(r.cp, tipo) ?? 0 });
      });
    }

    results.push({
      driver_nombre: driverNombre,
      driver_id: driverId,
      total_paquetes,
      base_imponible: base,
      iva_21,
      total,
      fecha_desde,
      fecha_hasta,
      lineas,
      warnings: [...warningsSet],
      detalle,
    });
  }
  results.sort((a, b) => b.total - a.total);
  return results;
}

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
        <p className="text-muted-text text-sm mt-1">
          Cambios de tarifa que enviaste, con la etapa de aprobación en la que están.
        </p>
      </div>

      {loading ? (
        <p className="text-muted-text font-mono text-xs">Cargando…</p>
      ) : items.length === 0 ? (
        <div className="px-4 py-6 border-l-2 border-hairline bg-surface-2/40 text-muted-text font-mono text-xs rounded-r">
          Todavía no enviaste ninguna solicitud de cambio de tarifa.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((s) => (
            <div key={s.id} className="bg-surface border border-hairline rounded-lg p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {s.driver_nombre} <span className="text-muted-text font-normal">· CP {s.codigo_postal}</span>
                  </p>
                  <p className="text-[11px] text-muted-text mt-1 font-mono">
                    Enviada {new Date(s.solicitado_en).toLocaleString("es-ES")}
                  </p>
                  <p className="text-xs text-ink mt-2 font-mono">
                    {(Object.keys(s.valores_propuestos) as (keyof ValoresTarifa)[])
                      .filter((c) => s.valores_propuestos[c] !== null && s.valores_propuestos[c] !== undefined)
                      .map((c) => `${CAMPO_LABEL_SOLICITUD[c]}: ${fmtValor(s.valores_propuestos[c])}`)
                      .join(" · ")}
                  </p>
                </div>
                <span className={`shrink-0 px-2 py-1 rounded border text-[10px] font-mono uppercase tracking-wide ${ESTADO_COLOR[s.estado]}`}>
                  {ESTADO_LABEL[s.estado]}
                </span>
              </div>
              {s.estado === "rechazado" && (
                <div className="mt-3 px-3 py-2 rounded border-l-2 border-danger bg-danger/10 text-xs">
                  <p className="text-danger font-medium">
                    Rechazado por {s.rechazado_nombre} (etapa {s.rechazado_en_etapa})
                  </p>
                  {s.motivo_rechazo && <p className="text-ink mt-1">{s.motivo_rechazo}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
      const [{ data: driversData, error: dErr }, { data: tarifasData, error: tErr }] = await Promise.all([
        supabase.from("drivers").select("id, hub_id, nombre").eq("hub_id", hubId),
        supabase
          .from("driver_tarifas")
          .select("id, hub_id, driver_id, codigo_postal, precio_door, precio_pudo, precio_aa")
          .eq("hub_id", hubId)
          .not("driver_id", "is", null),
      ]);
      if (dErr) throw dErr;
      if (tErr) throw tErr;
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
      const rows = await fetchEpodLineas();
      const res = processEpodLineas(rows, tarifas, drivers);
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
