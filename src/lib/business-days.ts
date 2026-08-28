// Único precedente de "días hábiles" en el repo hoy es la regla SQL de
// dashboard_dsr_stats() (EXTRACT(ISODOW FROM d) < 6, lunes=1..domingo=7).
// Estas utilidades replican el mismo criterio (L-V) en el frontend para KPIs
// que se calculan directo del cliente (CD5) en vez de un RPC.

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay(); // 0=domingo … 6=sábado
  return dow !== 0 && dow !== 6;
}

/** Fecha ISO tratada como UTC-midnight para evitar corrimientos por huso horario. */
function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** El propio día si es hábil, si no el hábil más reciente hacia atrás. */
export function mostRecentBusinessDay(from: Date = new Date()): Date {
  let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (!isBusinessDay(d)) d = addDays(d, -1);
  return d;
}

/** Últimos `n` días hábiles (L-V), en orden ascendente, terminando en `endIso` (inclusive si es hábil). */
export function lastNBusinessDays(n: number, endIso?: string): string[] {
  const end = endIso ? mostRecentBusinessDay(parseIso(endIso)) : mostRecentBusinessDay();
  const out: string[] = [];
  let d = end;
  while (out.length < n) {
    if (isBusinessDay(d)) out.push(toIso(d));
    d = addDays(d, -1);
  }
  return out.reverse();
}

export function isoAddDays(iso: string, days: number): string {
  return toIso(addDays(parseIso(iso), days));
}

export { toIso, isBusinessDay };
