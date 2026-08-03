/**
 * Snapshots del módulo "Clientes Locales" persistidos en localStorage (sin
 * backend). Solo se guardan los campos esenciales por waybill, nunca el
 * archivo completo, para no acercarse al límite de ~5-10MB de localStorage.
 */

const MAX_AGE_DAYS = 30;
const MAX_AGE_MS = MAX_AGE_DAYS * 86400000;

const HISTORICO_KEY = "epod_historico";
const CD4_LOG_KEY = "cd4_log";
const DIA_SNAPSHOT_PREFIX = "epod_dia_snapshot_";

// ---------------------------------------------------------------------------
// EPOD Histórico -> T0 por waybill
// ---------------------------------------------------------------------------

export type HistoricoEntry = {
  waybill: string;
  t0: string; // ISO date/time de la fecha mínima encontrada para ese waybill
  cp: string;
  cliente: string;
  driver: string;
  clienteLocal: boolean;
  // ISO date de la primera vez que el waybill llegó a estado Entregado dentro
  // del histórico, o null si nunca se vio entregado en ese archivo.
  fechaEntrega: string | null;
};

export type HistoricoStore = {
  updatedAt: string;
  entries: HistoricoEntry[];
};

export function getHistorico(): HistoricoStore | null {
  try {
    const raw = localStorage.getItem(HISTORICO_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as HistoricoStore;
  } catch {
    return null;
  }
}

export function saveHistorico(entries: HistoricoEntry[]): void {
  try {
    const store: HistoricoStore = { updatedAt: new Date().toISOString(), entries };
    localStorage.setItem(HISTORICO_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Snapshot del EPOD del Día (uno por fecha, se reemplaza en cada resubida)
// ---------------------------------------------------------------------------

export type EstadoActual = "ENTREGADO" | "EN_REPARTO" | "FALLO" | "CANCELADO" | "OTRO";

export type DiaSnapshotEntry = {
  waybill: string;
  estado: EstadoActual;
  cp: string;
  cliente: string;
  driver: string;
  direccion: string;
};

export type DiaSnapshot = {
  fecha: string; // "YYYY-MM-DD"
  updatedAt: string;
  entries: DiaSnapshotEntry[];
};

function diaSnapshotKey(fecha: string): string {
  return `${DIA_SNAPSHOT_PREFIX}${fecha}`;
}

export function getDiaSnapshot(fecha: string): DiaSnapshot | null {
  try {
    const raw = localStorage.getItem(diaSnapshotKey(fecha));
    if (!raw) return null;
    return JSON.parse(raw) as DiaSnapshot;
  } catch {
    return null;
  }
}

export function saveDiaSnapshot(snapshot: DiaSnapshot): void {
  try {
    localStorage.setItem(diaSnapshotKey(snapshot.fecha), JSON.stringify(snapshot));
  } catch {
    /* ignore */
  }
  cleanupOldData();
}

// ---------------------------------------------------------------------------
// CD4 — log histórico ligero para "días consecutivos"
// ---------------------------------------------------------------------------

export type Cd4LogEntry = {
  waybill: string;
  dias: number;
  cliente: string;
  cp: string;
};

export type Cd4Log = Record<string, Cd4LogEntry[]>; // fecha ("YYYY-MM-DD") -> entradas

export function getCd4Log(): Cd4Log {
  try {
    const raw = localStorage.getItem(CD4_LOG_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Cd4Log;
  } catch {
    return {};
  }
}

export function saveCd4LogForDate(fecha: string, entries: Cd4LogEntry[]): void {
  try {
    const log = getCd4Log();
    log[fecha] = entries;
    localStorage.setItem(CD4_LOG_KEY, JSON.stringify(log));
  } catch {
    /* ignore */
  }
}

/** Cuenta cuántos días seguidos (sin contar hoy) aparece el waybill en el log, mirando hacia atrás desde `fecha`. */
export function countConsecutivePriorDays(waybill: string, fecha: string, log: Cd4Log): number {
  let count = 0;
  const cursor = new Date(`${fecha}T00:00:00Z`);
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const key = cursor.toISOString().slice(0, 10);
    const entries = log[key];
    if (!entries || !entries.some((e) => e.waybill === waybill)) break;
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Limpieza de datos antiguos (>30 días)
// ---------------------------------------------------------------------------

export function cleanupOldData(): void {
  try {
    const cutoff = Date.now() - MAX_AGE_MS;

    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DIA_SNAPSHOT_PREFIX)) continue;
      const fecha = key.slice(DIA_SNAPSHOT_PREFIX.length);
      const ts = Date.parse(`${fecha}T00:00:00Z`);
      if (!isNaN(ts) && ts < cutoff) localStorage.removeItem(key);
    }

    const log = getCd4Log();
    let changed = false;
    for (const fecha of Object.keys(log)) {
      const ts = Date.parse(`${fecha}T00:00:00Z`);
      if (!isNaN(ts) && ts < cutoff) {
        delete log[fecha];
        changed = true;
      }
    }
    if (changed) localStorage.setItem(CD4_LOG_KEY, JSON.stringify(log));
  } catch {
    /* ignore */
  }
}
