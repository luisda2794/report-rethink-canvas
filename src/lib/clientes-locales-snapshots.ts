import type { Categoria } from "@/lib/client-category";

/**
 * Snapshots del módulo "Clientes Locales" persistidos en localStorage (sin
 * backend). Solo se guardan los campos esenciales por waybill, nunca el
 * archivo completo, para no acercarse al límite de ~5-10MB de localStorage.
 */

const MAX_AGE_DAYS = 30;
const MAX_AGE_MS = MAX_AGE_DAYS * 86400000;

const HISTORICO_KEY = "epod_historico";
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
  // Clasificación LOCAL/TEMU/ALIEXPRESS/SHEIN — se calcula para TODAS las
  // filas (no solo las de clienteLocal=true), para poder armar los % CD4/CD5
  // de TEMU y ALIEXPRESS además de SHEIN/Resto Locales.
  categoria: Categoria;
  // Estado actual (clasificado) de la última fila vista para el waybill
  // dentro del histórico, al momento de subir ese archivo. Es solo un valor
  // de partida: en tiempo de análisis siempre se recalcula el "estado de
  // hoy" real (ver resolveWaybillToday en reportes_.clientes-locales.tsx) —
  // si el waybill tiene fila hoy, se usa esa; si no, se asume Entregado.
  estadoActual: EstadoActual;
  // Última incidencia no vacía vista para el waybill (para excluir Dirección
  // Incorrecta de los reportes % CD4/CD5).
  ultimaIncidencia: string;
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
