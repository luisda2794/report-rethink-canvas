// Regla ya establecida en SHEIN CD4 / Locales CD5 (reportes_.clientes-locales.tsx):
// un waybill cuya última incidencia sea "Dirección Incorrecta" se excluye del
// cohorte de CD4/CD5 por completo (no cuenta ni en el numerador ni en el
// denominador) — a diferencia de otras incidencias (ej. "Vehículo Averiado"),
// que sí se cuentan con normalidad. Se reutiliza acá para las mismas reglas
// de negocio en /reportes (KPIs) y CD5.
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const DIRECCION_INCORRECTA_VARIANTS = new Set([
  "direccion incorrecta",
  "dirreccion incorrecta",
  "address error",
]);

export function isDireccionIncorrecta(s: string): boolean {
  return DIRECCION_INCORRECTA_VARIANTS.has(stripAccents(s).trim().toLowerCase());
}
