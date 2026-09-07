import type { SupabaseClient } from "@supabase/supabase-js";

// Extraído de /pudos para poder reutilizarlo desde el agente "Detección
// Fraude PUDO" (Equipo Operativo) sin duplicar la lógica del gap — el
// cálculo es el mismo, lo único que cambia es qué cliente de Supabase lo
// corre (el del navegador con la sesión del usuario para la pantalla, o
// supabaseAdmin con la service role para el agente).

export const ALERT_THRESHOLD_M = 250;
const PAGE_SIZE = 1000;

export type PudoLinea = {
  waybill: string | null;
  lp_no: string;
  pop_station_id: string | null;
  direccion: string | null;
  cp: string | null;
  latitude: number | null;
  longitude: number | null;
  entrega_real_latitude: number | null;
  entrega_real_longitude: number | null;
};

export type Paquete = {
  waybill: string | null;
  lp_no: string;
  cp: string | null;
  gap: number | null; // metros; null = sin datos de ubicación real
  alerta: boolean;
};

export type PuntoPudo = {
  key: string; // pop_station_id, o "sin-punto"
  direccion: string;
  paquetes: Paquete[];
  nEntregados: number;
  nAlertas: number;
  nSinDatos: number;
  gapPromedio: number | null;
  gapMax: number | null;
};

// Fórmula haversine — distancia en metros entre dos coordenadas GPS.
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function fetchPudoLineas(
  client: SupabaseClient,
  hubId: string,
  fecha: string,
): Promise<PudoLinea[]> {
  const { count, error: countErr } = await client
    .from("epod_lineas")
    .select("id", { count: "exact", head: true })
    .eq("hub_id", hubId)
    .eq("fecha", fecha)
    .eq("tipo_norm", "PUDO")
    .eq("estado", "Entregado");
  if (countErr) throw countErr;
  const total = count ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => {
      const from = i * PAGE_SIZE;
      return client
        .from("epod_lineas")
        .select("waybill, lp_no, pop_station_id, direccion, cp, latitude, longitude, entrega_real_latitude, entrega_real_longitude")
        .eq("hub_id", hubId)
        .eq("fecha", fecha)
        .eq("tipo_norm", "PUDO")
        .eq("estado", "Entregado")
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
    }),
  );
  const out: PudoLinea[] = [];
  for (const { data, error: qErr } of pages) {
    if (qErr) throw qErr;
    out.push(...((data ?? []) as PudoLinea[]));
  }
  return out;
}

export function computePuntos(lineas: PudoLinea[]): PuntoPudo[] {
  const grupos = new Map<string, PudoLinea[]>();
  for (const l of lineas) {
    const key = l.pop_station_id?.trim() || "sin-punto";
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(l);
  }

  const puntos: PuntoPudo[] = [];
  for (const [key, rows] of grupos) {
    const direccion = rows.find((r) => r.direccion)?.direccion ?? (key === "sin-punto" ? "Sin punto identificado" : "—");
    const paquetes: Paquete[] = rows.map((r) => {
      const tieneAmbas =
        r.latitude != null && r.longitude != null && r.entrega_real_latitude != null && r.entrega_real_longitude != null;
      const gap = tieneAmbas
        ? haversineMeters(r.latitude as number, r.longitude as number, r.entrega_real_latitude as number, r.entrega_real_longitude as number)
        : null;
      return {
        waybill: r.waybill,
        lp_no: r.lp_no,
        cp: r.cp,
        gap,
        alerta: gap != null && gap > ALERT_THRESHOLD_M,
      };
    });
    const conGap = paquetes.filter((p) => p.gap != null).map((p) => p.gap as number);
    puntos.push({
      key,
      direccion,
      paquetes,
      nEntregados: paquetes.length,
      nAlertas: paquetes.filter((p) => p.alerta).length,
      nSinDatos: paquetes.filter((p) => p.gap == null).length,
      gapPromedio: conGap.length > 0 ? conGap.reduce((a, b) => a + b, 0) / conGap.length : null,
      gapMax: conGap.length > 0 ? Math.max(...conGap) : null,
    });
  }
  puntos.sort((a, b) => b.nAlertas - a.nAlertas || b.nEntregados - a.nEntregados);
  return puntos;
}
