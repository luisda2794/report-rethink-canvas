/**
 * "Fecha de la tarea" / "Task Date" en los ePOD de Cainiao es la fecha de
 * asignación/batch de la tarea, NO el momento real en que ocurrió el evento
 * (entrega o fallo de entrega) — puede haber días de diferencia entre ambas.
 *
 * Esta función devuelve la fecha REAL de cada fila:
 * 1. Estado Entregado/Delivered/Return_to_seller_success -> "Tiempo de Entrega" / "Delivery Time"
 * 2. Estado Attempt Failure/Return_to_seller_fail -> "Tiempo del Fracaso de la Entrega" / "Delivery Failure Time"
 * 3. Cualquier otro caso, o si la columna correspondiente no tiene valor -> "Fecha de la tarea" / "Task Date" (respaldo)
 */

function normalizeEstadoForEventDate(s: string): string {
  return s.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function isDeliveredEstado(s: string): boolean {
  const n = normalizeEstadoForEventDate(s);
  return n === "entregado" || n === "delivered" || n === "return to seller success";
}

function isFailedEstado(s: string): boolean {
  const n = normalizeEstadoForEventDate(s);
  return n === "attempt failure" || n === "return to seller fail";
}

export function resolveEventDate(params: {
  estado: string;
  fechaTarea: Date | null;
  tiempoEntrega: Date | null;
  tiempoFracaso: Date | null;
}): Date | null {
  const { estado, fechaTarea, tiempoEntrega, tiempoFracaso } = params;
  if (isDeliveredEstado(estado) && tiempoEntrega) return tiempoEntrega;
  if (isFailedEstado(estado) && tiempoFracaso) return tiempoFracaso;
  return fechaTarea;
}
