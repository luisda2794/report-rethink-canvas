// Cálculo de "lo que pagamos a drivers" — extraído de borradores.tsx para
// poder reutilizarlo fuera de esa pantalla (ej. el dashboard de
// Reconciliación de Pagos Cainiao, que necesita el mismo número sin pasar
// por la UI de generación de borradores). Lógica de negocio sin cambios
// salvo un fix: ahora sí suma situaciones_especiales (antes se ignoraban
// por completo, así que cualquier hub/periodo con una situación especial
// activa daba un total sistemáticamente mal).

export type Driver = {
  id: string;
  hub_id: string;
  nombre: string;
};

export type Tarifa = {
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

// Situación especial ya resuelta para el cálculo — mismo shape que la fila
// de situaciones_especiales, sin los campos que el cálculo no necesita
// (id, hub_id, nota). Todos los campos de tarifa son opcionales: si un
// campo queda null, ese concepto puntual cae de vuelta a la tarifa normal
// del driver+CP (mismo criterio ya usado al guardar la situación especial).
export type SituacionEspecialCalc = {
  driver_id: string;
  fecha: string;
  codigo_postal: string;
  tarifa_to_door: number | null;
  tarifa_pudo_primero: number | null;
  tarifa_pudo_extra: number | null;
  precio_salida: number | null;
};

// "AA" es internamente el mismo nombre que ya usaba driver_tarifas.precio_aa,
// pero cambió de significado: antes era el 2º+ intento TO_DOOR a la misma
// dirección; ahora es el modelo PUDO por punto/día (1er paquete del día en un
// pop_station_id = PUDO, los siguientes al mismo punto/día = AA).
export type DraftLine = {
  cp: string;
  tipo: "TO_DOOR" | "PUDO" | "AA";
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  // true si este precio salió de una situación especial (no de driver_tarifas)
  // — reservado para cuando se agregue la marca visual en el Excel; hoy no
  // se consume en ningún lado todavía.
  especial?: boolean;
};

export const TIPO_LABEL: Record<DraftLine["tipo"], string> = {
  TO_DOOR: "TO_DOOR",
  PUDO: "PUDO (1º del día)",
  AA: "PUDO (extra, mismo punto/día)",
};

export type DetalleRow = {
  fecha: string;
  direccion: string;
  cp: string;
  tipo: DraftLine["tipo"];
  precio_unitario: number;
  especial?: boolean;
};

export type DraftResult = {
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
  // Suma de "Precio de Salida" de situaciones especiales ya incluida en
  // base_imponible/total — se expone aparte para que cualquier pantalla que
  // quiera desglosarlo (ej. el dashboard Cainiao) no tenga que recalcularlo.
  precio_salida_total?: number;
};

export type EpodLineaBillingRow = {
  lp_no: string;
  driver: string | null;
  fecha: string | null;
  cp: string | null;
  direccion: string | null;
  tipo_norm: string | null;
  pop_station_id: string | null;
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
export function processEpodLineas(
  rows: EpodLineaBillingRow[],
  tarifas: Tarifa[],
  drivers: Driver[],
  situaciones: SituacionEspecialCalc[] = [],
): DraftResult[] {
  if (rows.length === 0) return [];

  const tarifaByDriverCp = new Map(
    tarifas.map((t) => [`${t.driver_id}|${t.codigo_postal.trim()}`, t]),
  );
  const driverByName = new Map(drivers.map((d) => [normalizeName(d.nombre), d]));
  const situacionByKey = new Map(
    situaciones.map((s) => [`${s.driver_id}|${s.fecha}|${s.codigo_postal.trim()}`, s]),
  );

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

    // Precio efectivo para un paquete puntual: prioriza la situación
    // especial de ese driver+fecha+CP (por campo — si el campo específico
    // de esa situación quedó vacío, cae a la tarifa normal), si no hay
    // situación usa driver_tarifas tal cual.
    const priceFor = (
      cp: string,
      tipo: DraftLine["tipo"],
      fecha: string,
    ): { precio: number | null; especial: boolean } => {
      const sit = situacionByKey.get(`${driverId}|${fecha}|${cp}`);
      const tar = tarifaByDriverCp.get(`${driverId}|${cp}`);
      if (sit) {
        const campo =
          tipo === "PUDO" ? sit.tarifa_pudo_primero : tipo === "AA" ? sit.tarifa_pudo_extra : sit.tarifa_to_door;
        if (campo !== null && campo !== undefined) return { precio: Number(campo), especial: true };
      }
      if (!tar) return { precio: null, especial: !!sit };
      const normal = tipo === "PUDO" ? Number(tar.precio_pudo) : tipo === "AA" ? Number(tar.precio_aa) : Number(tar.precio_door);
      return { precio: normal, especial: !!sit };
    };

    // TO_DOOR: cantidad simple por CP — pero ahora agrupada también por
    // precio/especial, ya que un mismo CP puede tener paquetes a precio
    // normal y otros a precio especial dentro del mismo periodo.
    const doorRows = rs.filter((r) => r.tipo === "TO_DOOR");

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

    const lineas: DraftLine[] = [];
    let base = 0;
    let total_paquetes = 0;
    const cpsWithoutTarifa = new Set<string>();
    const pushLinea = (cp: string, tipo: DraftLine["tipo"], cantidad: number, precio: number, especial: boolean) => {
      if (cantidad <= 0) return;
      const subtotal = +(cantidad * precio).toFixed(2);
      lineas.push({ cp: cp || "(sin CP)", tipo, cantidad, precio_unitario: precio, subtotal, especial: especial || undefined });
      base += subtotal;
      total_paquetes += cantidad;
    };

    type Grouped = { cp: string; tipo: DraftLine["tipo"]; precio: number; especial: boolean; cantidad: number };
    const doorGroups = new Map<string, Grouped>();
    for (const r of doorRows) {
      const { precio, especial } = priceFor(r.cp, "TO_DOOR", r.fecha);
      if (precio === null) cpsWithoutTarifa.add(r.cp || "(sin CP)");
      const p = precio ?? 0;
      const key = `${r.cp} TO_DOOR ${p} ${especial}`;
      const g = doorGroups.get(key);
      if (g) g.cantidad += 1;
      else doorGroups.set(key, { cp: r.cp, tipo: "TO_DOOR", precio: p, especial, cantidad: 1 });
    }
    for (const g of doorGroups.values()) pushLinea(g.cp, g.tipo, g.cantidad, g.precio, g.especial);

    const pudoLineGroups = new Map<string, Grouped>();
    for (const group of pudoGroups.values()) {
      group.forEach((r, i) => {
        const tipo: DraftLine["tipo"] = i === 0 ? "PUDO" : "AA";
        const { precio, especial } = priceFor(r.cp, tipo, r.fecha);
        if (precio === null) cpsWithoutTarifa.add(r.cp || "(sin CP)");
        const p = precio ?? 0;
        const key = `${r.cp} ${tipo} ${p} ${especial}`;
        const g = pudoLineGroups.get(key);
        if (g) g.cantidad += 1;
        else pudoLineGroups.set(key, { cp: r.cp, tipo, precio: p, especial, cantidad: 1 });
      });
    }
    for (const g of pudoLineGroups.values()) pushLinea(g.cp, g.tipo, g.cantidad, g.precio, g.especial);

    for (const cp of cpsWithoutTarifa) warningsSet.add(`CP ${cp} sin tarifa configurada para ${driverNombre}`);

    // Precio de Salida: pago fijo por día (no por paquete) — se suma UNA
    // sola vez por (driver, fecha), incluso si esa fecha tiene situaciones
    // especiales en más de un CP (no debería pasar en la práctica, pero si
    // pasa se toma la primera y se ignoran las repetidas en vez de sumar
    // varias veces el mismo concepto).
    const salidaPorDia = new Map<string, number>();
    for (const s of situaciones) {
      if (s.driver_id !== driverId) continue;
      if (s.precio_salida === null || s.precio_salida === undefined) continue;
      if (!salidaPorDia.has(s.fecha)) salidaPorDia.set(s.fecha, Number(s.precio_salida));
    }
    let precioSalidaTotal = 0;
    for (const v of salidaPorDia.values()) precioSalidaTotal += v;
    if (precioSalidaTotal > 0) {
      base += precioSalidaTotal;
      warningsSet.add(`Incluye ${precioSalidaTotal.toFixed(2)}€ de "Precio de Salida" por situación especial`);
    }

    lineas.sort((a, b) => a.cp.localeCompare(b.cp) || a.tipo.localeCompare(b.tipo));
    base = +base.toFixed(2);
    const iva_21 = +(base * 0.21).toFixed(2);
    const total = +(base + iva_21).toFixed(2);

    // Detalle por paquete (para la sección "Detalle por día" del Excel) —
    // misma clasificación TO_DOOR/PUDO-1º/PUDO-Nº que ya se usó arriba para
    // el agregado, pero sin agregar: una fila por paquete.
    const detalle: DetalleRow[] = [];
    for (const r of doorRows) {
      const { precio, especial } = priceFor(r.cp, "TO_DOOR", r.fecha);
      detalle.push({ fecha: r.fecha, direccion: r.direccion, cp: r.cp, tipo: "TO_DOOR", precio_unitario: precio ?? 0, especial: especial || undefined });
    }
    for (const group of pudoGroups.values()) {
      group.forEach((r, i) => {
        const tipo: DraftLine["tipo"] = i === 0 ? "PUDO" : "AA";
        const { precio, especial } = priceFor(r.cp, tipo, r.fecha);
        detalle.push({ fecha: r.fecha, direccion: r.direccion, cp: r.cp, tipo, precio_unitario: precio ?? 0, especial: especial || undefined });
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
      precio_salida_total: precioSalidaTotal > 0 ? precioSalidaTotal : undefined,
    });
  }
  results.sort((a, b) => b.total - a.total);
  return results;
}
