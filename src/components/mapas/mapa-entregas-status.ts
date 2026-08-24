// Clasificación de estado para el Mapa de Entregas: mismos 3 buckets que
// pidió el negocio (Entregado / Incidencia / Asignado-En reparto), sobre el
// valor ya normalizado en epod_lineas.estado (ver normalizeEstado en
// epod.tsx) — se compara tolerante a mayúsculas/espacios/guiones bajos por
// si algún ePOD trae variantes distintas.

export type EntregaStatus = "entregado" | "incidencia" | "en_reparto" | "otro";

function normalize(s: string): string {
  return (s || "").trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

export function classifyEstado(estadoRaw: string): EntregaStatus {
  const s = normalize(estadoRaw);
  if (s === "entregado" || s === "delivered") return "entregado";
  if (s === "attempt failure" || s === "cancelar" || s === "cancel" || s === "cancelled" || s === "canceled") {
    return "incidencia";
  }
  if (s === "driver received" || s === "driver received incidencias" || s === "assigned" || s === "asignado") {
    return "en_reparto";
  }
  return "otro";
}

// Verde = éxito, Rojo = problema, Azul (--electric) = en curso — mismos
// tokens que ya usa el resto de Menssajero (var(--success/--danger/--electric)).
export const STATUS_COLOR: Record<EntregaStatus, string> = {
  entregado: "var(--success)",
  incidencia: "var(--danger)",
  en_reparto: "var(--electric)",
  otro: "#9ca3af",
};

export const STATUS_LABEL: Record<EntregaStatus, string> = {
  entregado: "Entregados",
  incidencia: "Incidencias",
  en_reparto: "Asignados / En reparto",
  otro: "Otros",
};
