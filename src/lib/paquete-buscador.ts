import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { haversineMeters } from "@/lib/pudos-calc";
import { isDeliveredEstado, isFailedEstado, resolveEventDate } from "@/lib/resolve-event-date";

// Nota sobre el tipado: el parámetro de cliente de las dos funciones de fetch
// se tipa como SupabaseClient sin el genérico Database (igual que
// fetchPudoLineas en pudos-calc.ts) porque entrega_real_latitude/
// entrega_real_longitude existen en la tabla real (migración
// pudos_entrega_real) pero todavía no en el types.ts generado — con el
// cliente tipado normal, seleccionar esas columnas por string no compila.

// Buscador de Paquetes: busca por Waybill o LP y reconstruye la trayectoria
// completa de un paquete a partir de sus filas en epod_lineas (una fila por
// evento/subida de ePOD que lo mencionó — no una fila por paquete). No filtra
// por hub_id a propósito: RLS de epod_lineas ya restringe el resultado a los
// hubs a los que el usuario tiene acceso (is_admin() o usuario_hubs), así que
// un manager/jefe_flota con varios hubs puede encontrar un paquete sin saber
// de antemano en cuál está, y un admin lo encuentra en cualquiera.
//
// Se hacen dos queries (waybill exacto, lp_no exacto) en vez de un .or(...)
// para no tener que escapar comas/caracteres especiales del texto pegado por
// el usuario dentro del filtro embebido que usa PostgREST.

export type PaqueteLineaRaw = {
  id: string;
  hub_id: string;
  waybill: string | null;
  lp_no: string;
  driver: string | null;
  fecha: string | null;
  fecha_inbound: string | null;
  cp: string | null;
  ciudad: string | null;
  direccion: string | null;
  contacto: string | null;
  tipo: string | null;
  tipo_norm: string | null;
  estado: string;
  pop_station_id: string | null;
  market_place_name: string | null;
  seller_name: string | null;
  latitude: number | null;
  longitude: number | null;
  entrega_real_latitude: number | null;
  entrega_real_longitude: number | null;
  row_index: number;
  exception_detail: string | null;
  tiempo_entrega: string | null;
  tiempo_fracaso: string | null;
};

export type ReclamacionRaw = {
  id: string;
  ref: string;
  tipo: string;
  estado: string;
  importe: number | null;
  comentarios: string | null;
  fecha_entrega: string | null;
  created_at: string;
  hub_id: string;
};

export type EventoTrayectoria = {
  id: string;
  fechaEvento: string | null; // fecha real resuelta (entrega/fracaso/tarea) — puede venir null
  fecha: string | null; // fecha de la tarea, cruda
  estado: string;
  hubId: string;
  driver: string | null;
  cp: string | null;
  ciudad: string | null;
  direccion: string | null;
  contacto: string | null;
  tipo: string | null;
  tipoNorm: string | null;
  popStationId: string | null;
  esIncidencia: boolean;
  incidenciaDetalle: string | null;
  esFallo: boolean;
  esEntrega: boolean;
  gapMetros: number | null;
};

export type PaqueteResultado = {
  id: string; // waybill || lp_no
  waybill: string | null;
  lpNo: string;
  eventos: EventoTrayectoria[];
  hubActualId: string | null;
  estadoActual: string | null;
  intentosFallidos: number;
  incidencias: EventoTrayectoria[];
  entregado: boolean;
  fechaInbound: string | null;
  marketPlaceName: string | null;
  sellerName: string | null;
  reclamaciones: ReclamacionRaw[];
};

const SELECT_COLS =
  "id, hub_id, waybill, lp_no, driver, fecha, fecha_inbound, cp, ciudad, direccion, contacto, tipo, tipo_norm, estado, pop_station_id, market_place_name, seller_name, latitude, longitude, entrega_real_latitude, entrega_real_longitude, row_index, exception_detail, tiempo_entrega, tiempo_fracaso";

async function fetchLineasPorIdentificador(client: SupabaseClient, query: string): Promise<PaqueteLineaRaw[]> {
  const q = query.trim();
  if (!q) return [];

  const [byWaybill, byLp] = await Promise.all([
    client.from("epod_lineas").select(SELECT_COLS).eq("waybill", q),
    client.from("epod_lineas").select(SELECT_COLS).eq("lp_no", q),
  ]);
  if (byWaybill.error) throw byWaybill.error;
  if (byLp.error) throw byLp.error;

  const byId = new Map<string, PaqueteLineaRaw>();
  for (const r of [...(byWaybill.data ?? []), ...(byLp.data ?? [])] as PaqueteLineaRaw[]) {
    byId.set(r.id, r);
  }
  return Array.from(byId.values());
}

async function fetchReclamaciones(client: SupabaseClient, query: string): Promise<ReclamacionRaw[]> {
  const q = query.trim();
  if (!q) return [];
  const [byWaybill, byLp] = await Promise.all([
    client
      .from("reclamaciones")
      .select("id, ref, tipo, estado, importe, comentarios, fecha_entrega, created_at, hub_id")
      .eq("waybill", q),
    client
      .from("reclamaciones")
      .select("id, ref, tipo, estado, importe, comentarios, fecha_entrega, created_at, hub_id")
      .eq("lp_no", q),
  ]);
  if (byWaybill.error) throw byWaybill.error;
  if (byLp.error) throw byLp.error;
  const byId = new Map<string, ReclamacionRaw>();
  for (const r of [...(byWaybill.data ?? []), ...(byLp.data ?? [])] as ReclamacionRaw[]) {
    byId.set(r.id, r);
  }
  return Array.from(byId.values());
}

// gap de distancia GPS del registro (mismo cálculo que /pudos: haversine entre
// el punto registrado del ePOD y la ubicación real de entrega). Solo existe
// para filas que traen ambas coordenadas — normalmente entregas PUDO, no
// todas las filas.
function gapMetrosDeFila(r: PaqueteLineaRaw): number | null {
  if (r.latitude == null || r.longitude == null || r.entrega_real_latitude == null || r.entrega_real_longitude == null) {
    return null;
  }
  return haversineMeters(r.latitude, r.longitude, r.entrega_real_latitude, r.entrega_real_longitude);
}

function toEvento(r: PaqueteLineaRaw): EventoTrayectoria {
  const fechaEvento = resolveEventDate({
    estado: r.estado,
    fechaTarea: r.fecha ? new Date(r.fecha) : null,
    tiempoEntrega: r.tiempo_entrega ? new Date(r.tiempo_entrega) : null,
    tiempoFracaso: r.tiempo_fracaso ? new Date(r.tiempo_fracaso) : null,
  });
  const detalle = (r.exception_detail ?? "").trim();
  return {
    id: r.id,
    fechaEvento: fechaEvento ? fechaEvento.toISOString().slice(0, 10) : null,
    fecha: r.fecha,
    estado: r.estado,
    hubId: r.hub_id,
    driver: r.driver,
    cp: r.cp,
    ciudad: r.ciudad,
    direccion: r.direccion,
    contacto: r.contacto,
    tipo: r.tipo,
    tipoNorm: r.tipo_norm,
    popStationId: r.pop_station_id,
    esIncidencia: detalle.length > 0,
    incidenciaDetalle: detalle || null,
    esFallo: isFailedEstado(r.estado),
    esEntrega: isDeliveredEstado(r.estado),
    gapMetros: gapMetrosDeFila(r),
  };
}

function ordenarEventos(a: PaqueteLineaRaw, b: PaqueteLineaRaw): number {
  const fa = a.fecha ?? "";
  const fb = b.fecha ?? "";
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a.row_index - b.row_index;
}

// epod_lineas no tiene UNIQUE constraint (ver comentario en epod.tsx junto al
// insert): si el mismo archivo de ePOD se sube dos veces, o el mismo
// waybill/lp_no aparece repetido dentro del mismo archivo con datos
// idénticos, quedan filas duplicadas byte-a-byte salvo por id/
// epod_upload_id/row_index. Sin filtrarlas, cada re-subida duplicaría
// también las entregas, los intentos fallidos y las incidencias en la
// trayectoria. Se compara TODO el contenido del evento (no solo fecha+
// estado) para no fusionar dos intentos reales y distintos del mismo día.
function fingerprintLinea(r: PaqueteLineaRaw): string {
  return [
    r.estado,
    r.fecha ?? "",
    r.driver ?? "",
    r.cp ?? "",
    r.direccion ?? "",
    r.contacto ?? "",
    r.tipo ?? "",
    r.tipo_norm ?? "",
    r.exception_detail ?? "",
    r.tiempo_entrega ?? "",
    r.tiempo_fracaso ?? "",
    r.pop_station_id ?? "",
    r.market_place_name ?? "",
    r.seller_name ?? "",
    r.latitude ?? "",
    r.longitude ?? "",
    r.entrega_real_latitude ?? "",
    r.entrega_real_longitude ?? "",
  ].join("|");
}

function dedupeLineas(lineas: PaqueteLineaRaw[]): PaqueteLineaRaw[] {
  const vistos = new Set<string>();
  const resultado: PaqueteLineaRaw[] = [];
  for (const r of lineas) {
    const key = fingerprintLinea(r);
    if (vistos.has(key)) continue;
    vistos.add(key);
    resultado.push(r);
  }
  return resultado;
}

export function buildResultado(lineas: PaqueteLineaRaw[], reclamaciones: ReclamacionRaw[]): PaqueteResultado | null {
  if (lineas.length === 0) return null;
  const ordenadas = [...dedupeLineas(lineas)].sort(ordenarEventos);
  const eventos = ordenadas.map(toEvento);
  const last = ordenadas[ordenadas.length - 1];

  // Primero de fecha_inbound (min); si ninguna fila la trae, min(fecha) como respaldo.
  const inbounds = ordenadas.map((r) => r.fecha_inbound).filter((v): v is string => !!v);
  const fechas = ordenadas.map((r) => r.fecha).filter((v): v is string => !!v);
  const fuente = inbounds.length > 0 ? inbounds : fechas;
  const fechaInbound = fuente.length > 0 ? fuente.reduce((min, v) => (v < min ? v : min)) : null;

  return {
    id: last.waybill || last.lp_no,
    waybill: last.waybill,
    lpNo: last.lp_no,
    eventos,
    hubActualId: last.hub_id,
    estadoActual: last.estado,
    intentosFallidos: eventos.filter((e) => e.esFallo).length,
    incidencias: eventos.filter((e) => e.esIncidencia),
    entregado: eventos.some((e) => e.esEntrega) && isDeliveredEstado(last.estado),
    fechaInbound,
    marketPlaceName: ordenadas.find((r) => r.market_place_name)?.market_place_name ?? null,
    sellerName: ordenadas.find((r) => r.seller_name)?.seller_name ?? null,
    reclamaciones,
  };
}

export function usePaqueteBuscador(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["paquete-buscador", q],
    enabled: q.length > 0,
    queryFn: async (): Promise<PaqueteResultado | null> => {
      const [lineas, reclamaciones] = await Promise.all([
        fetchLineasPorIdentificador(supabase, q),
        fetchReclamaciones(supabase, q),
      ]);
      return buildResultado(lineas, reclamaciones);
    },
    staleTime: 60 * 1000,
  });
}
