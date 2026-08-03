import * as XLSX from "xlsx";

/**
 * Store centralizado de datos de ePOD, por hub, en IndexedDB (sin backend).
 *
 * Reemplaza el dropzone propio de cada reporte: el ePOD se sube UNA vez en
 * /epod (por hub) y todos los reportes leen de aquí. Se guarda solo el
 * subconjunto de columnas que los reportes realmente usan (13 campos), no
 * las ~89 columnas del Cainiao completo.
 *
 * Metadata y filas viven en object stores separados: hubs con ~78k filas no
 * deben cargarse enteros solo para listar los hubs disponibles (getAllHubs
 * lee únicamente el store liviano de metadata).
 *
 * No usa la librería `idb` (no hay Node/npm en este entorno para agregar la
 * dependencia) — es un wrapper nativo mínimo sobre IndexedDB.
 */

// ---------------------------------------------------------------------------
// Esquema de campos (unión de lo que usan Flow Meeting, Paquetes en Riesgo,
// Duplicados, Súper Reporte y Clientes Locales) — español / inglés.
// ---------------------------------------------------------------------------

export const FIELD_ALIASES = {
  waybill: ["Número de Waybill", "Waybill Number"],
  fecha: ["Fecha de la tarea", "Task Date"],
  estado: ["Estado de la Tarea", "Task Status"],
  incidencia: ["Detalles de la Excepción", "Exception Detail"],
  cp: ["Código postal", "Zip Code"],
  ciudad: ["La ciudad de destino", "The destination city"],
  direccion: ["Dirección detallada", "Detailed address"],
  driver: ["Nombre del Repartidor", "Courier Name"],
  tipoEntrega: ["Tipo de Entrega", "Delivery Type"],
  mercado: ["Nombre del mercado", "Market Place Name"],
  vendedor: ["Nombre del vendedor", "Seller Name"],
  tiempoEntrega: ["Tiempo de Entrega", "Delivery Time"],
  tiempoFracaso: ["Tiempo del Fracaso de la Entrega", "Delivery Failure Time"],
} as const;

export type EpodField = keyof typeof FIELD_ALIASES;

export type EpodRow = {
  waybill: string;
  fecha: string | null; // ISO
  estado: string;
  incidencia: string;
  cp: string;
  ciudad: string;
  direccion: string;
  driver: string;
  tipoEntrega: string;
  mercado: string;
  vendedor: string;
  tiempoEntrega: string | null; // ISO
  tiempoFracaso: string | null; // ISO
  rowIndex: number;
};

export type EpodMetadata = {
  hub: string;
  uploadedAt: string;
  fileName: string;
  rowCount: number;
  minDate: string | null; // ISO date (yyyy-mm-dd)
  maxDate: string | null; // ISO date (yyyy-mm-dd)
  detectedFields: EpodField[];
};

export type EpodHubRecord = {
  hub: string;
  metadata: EpodMetadata;
  rows: EpodRow[];
};

// ---------------------------------------------------------------------------
// Parseo permisivo: nunca bloquea la subida por falta de una columna que
// algún reporte necesite — cada reporte valida lo suyo contra
// `detectedFields` al leer los datos guardados (ver requireFields).
// ---------------------------------------------------------------------------

function parseFechaValue(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    const utcDays = Math.floor(v - 25569);
    const utcMs = utcDays * 86400 * 1000 + (v - Math.floor(v)) * 86400 * 1000;
    return new Date(utcMs);
  }
  const s = String(v).trim();
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

export type ParsedEpod = {
  rows: EpodRow[];
  detectedFields: EpodField[];
  minDate: string | null;
  maxDate: string | null;
};

export async function parseEpodFile(file: File): Promise<ParsedEpod> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("El archivo no tiene hojas.");
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
  if (json.length === 0) throw new Error("El archivo está vacío.");

  const headers = Object.keys(json[0]);
  const colFor = {} as Partial<Record<EpodField, string>>;
  const detectedFields: EpodField[] = [];
  for (const field of Object.keys(FIELD_ALIASES) as EpodField[]) {
    const found = FIELD_ALIASES[field].find((a) => headers.includes(a));
    if (found) {
      colFor[field] = found;
      detectedFields.push(field);
    }
  }
  if (!colFor.waybill || !colFor.fecha || !colFor.estado) {
    const missing = (["waybill", "fecha", "estado"] as EpodField[]).filter((f) => !colFor[f]);
    throw new Error(
      `Faltan columnas básicas: ${missing.map((f) => FIELD_ALIASES[f].join(" / ")).join(", ")}. Verifica el formato del archivo.`,
    );
  }

  const rows: EpodRow[] = json.map((r, i) => {
    const get = (field: EpodField) => (colFor[field] ? String(r[colFor[field] as string] ?? "").trim() : "");
    const getDate = (field: EpodField) => {
      const col = colFor[field];
      if (!col) return null;
      const d = parseFechaValue(r[col]);
      return d ? d.toISOString() : null;
    };
    return {
      waybill: get("waybill"),
      fecha: getDate("fecha"),
      estado: get("estado"),
      incidencia: get("incidencia"),
      cp: get("cp"),
      ciudad: get("ciudad"),
      direccion: get("direccion"),
      driver: get("driver"),
      tipoEntrega: get("tipoEntrega"),
      mercado: get("mercado"),
      vendedor: get("vendedor"),
      tiempoEntrega: getDate("tiempoEntrega"),
      tiempoFracaso: getDate("tiempoFracaso"),
      rowIndex: i,
    };
  });

  const validDates = rows.map((r) => r.fecha).filter((d): d is string => !!d).sort();
  const minDate = validDates.length > 0 ? validDates[0].slice(0, 10) : null;
  const maxDate = validDates.length > 0 ? validDates[validDates.length - 1].slice(0, 10) : null;

  return { rows, detectedFields, minDate, maxDate };
}

const FIELD_LABEL: Record<EpodField, string> = Object.fromEntries(
  (Object.keys(FIELD_ALIASES) as EpodField[]).map((f) => [f, FIELD_ALIASES[f].join(" / ")]),
) as Record<EpodField, string>;

/** Reproduce el mensaje "Faltan columnas: ..." de antes, pero contra los datos ya guardados de un hub. */
export function requireFields(detectedFields: EpodField[], required: EpodField[]): void {
  const have = new Set(detectedFields);
  const missing = required.filter((f) => !have.has(f));
  if (missing.length > 0) {
    throw new Error(
      `Faltan columnas: ${missing.map((f) => FIELD_LABEL[f]).join(", ")}. Verifica el formato del archivo (se aceptan EPOD en español o en inglés).`,
    );
  }
}

// ---------------------------------------------------------------------------
// IndexedDB — dos stores: metadata (liviano, para listar hubs) y filas
// (pesado, solo se lee al abrir un reporte con un hub elegido).
// ---------------------------------------------------------------------------

const DB_NAME = "menssajero_epod";
const DB_VERSION = 1;
const META_STORE = "hubs_meta";
const ROWS_STORE = "hubs_rows";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "hub" });
      }
      if (!db.objectStoreNames.contains(ROWS_STORE)) {
        db.createObjectStore(ROWS_STORE, { keyPath: "hub" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function runRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStores<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(storeNames, mode);
    return await fn(tx);
  } finally {
    db.close();
  }
}

export async function saveEpodData(
  hub: string,
  rows: EpodRow[],
  meta: { fileName: string; rowCount: number; minDate: string | null; maxDate: string | null; detectedFields: EpodField[] },
): Promise<void> {
  const metadata: EpodMetadata = {
    hub,
    uploadedAt: new Date().toISOString(),
    fileName: meta.fileName,
    rowCount: meta.rowCount,
    minDate: meta.minDate,
    maxDate: meta.maxDate,
    detectedFields: meta.detectedFields,
  };
  await withStores([META_STORE, ROWS_STORE], "readwrite", async (tx) => {
    await runRequest(tx.objectStore(META_STORE).put(metadata));
    await runRequest(tx.objectStore(ROWS_STORE).put({ hub, rows }));
  });
}

export async function getEpodData(hub: string): Promise<EpodHubRecord | null> {
  return withStores([META_STORE, ROWS_STORE], "readonly", async (tx) => {
    const metadata = (await runRequest<EpodMetadata | undefined>(tx.objectStore(META_STORE).get(hub))) ?? null;
    if (!metadata) return null;
    const rowsRecord = await runRequest<{ hub: string; rows: EpodRow[] } | undefined>(tx.objectStore(ROWS_STORE).get(hub));
    return { hub, metadata, rows: rowsRecord?.rows ?? [] };
  });
}

/** Lista dinámica de hubs con datos cargados (solo metadata — nunca trae las filas). */
export async function getAllHubs(): Promise<EpodMetadata[]> {
  const all = await withStores([META_STORE], "readonly", (tx) => runRequest<EpodMetadata[]>(tx.objectStore(META_STORE).getAll()));
  return all.sort((a, b) => a.hub.localeCompare(b.hub, "es"));
}

export async function deleteEpodData(hub: string): Promise<void> {
  await withStores([META_STORE, ROWS_STORE], "readwrite", async (tx) => {
    await runRequest(tx.objectStore(META_STORE).delete(hub));
    await runRequest(tx.objectStore(ROWS_STORE).delete(hub));
  });
}

export async function renameHub(oldName: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("El nuevo nombre no puede estar vacío.");
  if (trimmed === oldName) return;
  await withStores([META_STORE, ROWS_STORE], "readwrite", async (tx) => {
    const metadata = await runRequest<EpodMetadata | undefined>(tx.objectStore(META_STORE).get(oldName));
    if (!metadata) throw new Error(`No hay datos para el hub "${oldName}".`);
    const rowsRecord = await runRequest<{ hub: string; rows: EpodRow[] } | undefined>(tx.objectStore(ROWS_STORE).get(oldName));
    await runRequest(tx.objectStore(META_STORE).put({ ...metadata, hub: trimmed }));
    await runRequest(tx.objectStore(ROWS_STORE).put({ hub: trimmed, rows: rowsRecord?.rows ?? [] }));
    await runRequest(tx.objectStore(META_STORE).delete(oldName));
    await runRequest(tx.objectStore(ROWS_STORE).delete(oldName));
  });
}
