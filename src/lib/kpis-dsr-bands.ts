// Tabla de bandas de cumplimiento para DSR en la página de KPIs — traduce el
// DSR real del día a un "% de KPIs cumplidos". Ninguna otra pantalla usa esta
// escala (el Dashboard tiene su propio semáforo DSR_GOAL=90/DSR_MIN=88, que
// es una cosa distinta), así que vive acá y no se reutiliza de otro lado.
export type DsrBand = { minDsr: number; pctKpi: number; label: string; color: string };

// oklch(...) sin token propio en styles.css: no hay un 4to color para la
// banda intermedia (solo existen --success/--warn/--danger), así que se usa
// un naranja ad-hoc entre --warn (ámbar, hue 70) y --danger (rojo, hue 25).
const ORANGE = "oklch(0.65 0.18 45)";

export const DSR_BANDS: DsrBand[] = [
  { minDsr: 96, pctKpi: 100, label: "≥ 96%", color: "var(--success)" },
  { minDsr: 94, pctKpi: 80, label: "94% – 95,9%", color: "var(--warn)" },
  { minDsr: 91, pctKpi: 50, label: "91% – 93,9%", color: ORANGE },
  { minDsr: 0, pctKpi: 0, label: "< 91%", color: "var(--danger)" },
];

export function dsrBandFor(dsrPct: number): DsrBand {
  return DSR_BANDS.find((b) => dsrPct >= b.minDsr) ?? DSR_BANDS[DSR_BANDS.length - 1];
}
