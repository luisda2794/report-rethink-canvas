// Espejo en TS de las reglas que aplica la función SQL riesgo_cd_stats /
// clasificar_origen (la fuente de verdad es Postgres). Sirve para fijar
// las reglas con tests.

export type Origen = "China" | "Local";

export const PLAZO_HORAS: Record<Origen, number> = { Local: 120, China: 216 };
export const CD9_HORAS = 216;

const MARKETS_CHINA = ["yun express", "postlink", "shunyou", "yanwen", "yuanyou xyc", "sf", "457owh"];

export function normTxt(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/\u00a0/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function clasificarOrigen(seller: string | null, market: string | null): Origen {
  if (MARKETS_CHINA.includes(normTxt(market))) return "China";
  const s = normTxt(seller);
  if (/(temu|shein|aliexpress|infinite remit)/.test(s) || s === "cbt_delivery") return "China";
  if (/[\u4e00-\u9fff]/.test(seller ?? "") || /(warehouse|foshan|shenzhen)/.test(s)) return "China";
  return "Local";
}

export function esDireccionIncorrecta(motivo: string | null): boolean {
  return /dir+eccion incorrecta/.test(normTxt(motivo));
}

export function limiteHoras(origen: Origen): number {
  return PLAZO_HORAS[origen];
}

/** CD9 si es chino o si un local ya pasó las 216 h desde inbound. */
export function metrica(origen: Origen, horasDesdeInbound: number): "CD5" | "CD9" {
  return origen === "China" || horasDesdeInbound > CD9_HORAS ? "CD9" : "CD5";
}

// Estados que cuentan como "en reparto hoy": el paquete solo entra en la
// lista si tiene hoy un evento con uno de estos estados (recibido por el
// repartidor, fallado o cancelado). Los entregados se excluyen siempre.
// Espejo de riesgo_cd_stats.
export const ESTADOS_REPARTO_HOY = [
  "driver_received",
  "driver_received_incidencias",
  "driver_received_incidence",
  "driver received incidence",
  "driver pick up",
  "attempt failure",
  "cancel",
  "cancelar",
  "cancelled",
] as const;

export function esEstadoRepartoHoy(status: string | null | undefined): boolean {
  return (ESTADOS_REPARTO_HOY as readonly string[]).includes((status ?? "").toLowerCase());
}
