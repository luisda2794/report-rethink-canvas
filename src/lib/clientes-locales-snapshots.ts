/**
 * Snapshots del módulo "Clientes Locales" persistidos en localStorage (sin
 * backend). Solo se guardan los campos esenciales por waybill, nunca el
 * archivo completo, para no acercarse al límite de ~5-10MB de localStorage.
 */

const MAX_AGE_DAYS = 30;
const MAX_AGE_MS = MAX_AGE_DAYS * 86400000;

const DIA_SNAPSHOT_PREFIX = "epod_dia_snapshot_";

// ---------------------------------------------------------------------------
// Snapshot del EPOD (uno por fecha, se reemplaza en cada resubida) — un solo
// archivo por análisis, sin histórico persistido aparte: T0 se calcula con
// la fecha más antigua de cada waybill dentro del propio archivo.
// ---------------------------------------------------------------------------

export type EstadoActual = "ENTREGADO" | "EN_REPARTO" | "FALLO" | "CANCELADO" | "ASIGNADO" | "OTRO";

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
  } catch {
    /* ignore */
  }
}
