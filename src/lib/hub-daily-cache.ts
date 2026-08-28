import { supabase } from "@/integrations/supabase/client";

// Caché de reportes pesados por hub+fecha (ver migración hub_daily_cache).
//
// Las funciones de LECTURA nunca propagan un error hacia arriba — si la
// consulta a hub_daily_cache falla por lo que sea (la tabla no existe
// todavía, PGRST205 por caché de esquema de PostgREST no refrescada, RLS,
// lo que sea), se trata exactamente igual que "no hay caché": se loguea y
// se devuelve null/vacío, y el llamador cae a cálculo en vivo. Esto es la
// causa raíz real del incidente anterior — antes un error de lectura rompía
// el hook entero en vez de degradar a cálculo en vivo.
export type CacheTipo = "cd5" | "flow_meeting" | "paquetes_en_riesgo";

export async function readCacheOne<T>(hubId: string, tipo: CacheTipo, fecha: string): Promise<T | null> {
  try {
    const { data, error } = await supabase
      .from("hub_daily_cache")
      .select("datos")
      .eq("hub_id", hubId)
      .eq("tipo", tipo)
      .eq("fecha", fecha)
      .maybeSingle();
    if (error) throw error;
    return (data?.datos as T | undefined) ?? null;
  } catch (e) {
    console.error(`[hub-daily-cache] readCacheOne(${tipo}, ${fecha}) falló, se sigue como si no hubiera caché:`, e);
    return null;
  }
}

export async function readCacheLatest<T>(hubId: string, tipo: CacheTipo): Promise<{ fecha: string; datos: T } | null> {
  try {
    const { data, error } = await supabase
      .from("hub_daily_cache")
      .select("fecha, datos")
      .eq("hub_id", hubId)
      .eq("tipo", tipo)
      .order("fecha", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { fecha: data.fecha, datos: data.datos as T };
  } catch (e) {
    console.error(`[hub-daily-cache] readCacheLatest(${tipo}) falló, se sigue como si no hubiera caché:`, e);
    return null;
  }
}

export async function readCacheRange<T>(hubId: string, tipo: CacheTipo, fechas: string[]): Promise<Map<string, T>> {
  const map = new Map<string, T>();
  if (fechas.length === 0) return map;
  try {
    const { data, error } = await supabase
      .from("hub_daily_cache")
      .select("fecha, datos")
      .eq("hub_id", hubId)
      .eq("tipo", tipo)
      .in("fecha", fechas);
    if (error) throw error;
    for (const row of data ?? []) map.set(row.fecha, row.datos as T);
    return map;
  } catch (e) {
    console.error(`[hub-daily-cache] readCacheRange(${tipo}) falló, se sigue como si no hubiera caché:`, e);
    return map; // vacío — el llamador lo trata igual que "nada cacheado"
  }
}

// Las funciones de ESCRITURA sí siguen tirando error — son fire-and-forget
// en cada llamador (`void writeCache(...).catch(...)`), nunca deben frenar
// ni romper la vista que las dispara.
export async function writeCache(hubId: string, tipo: CacheTipo, fecha: string, datos: unknown): Promise<void> {
  const { error } = await supabase
    .from("hub_daily_cache")
    .upsert(
      { hub_id: hubId, tipo, fecha, datos: datos as never, calculado_en: new Date().toISOString() },
      { onConflict: "hub_id,fecha,tipo" },
    );
  if (error) throw error;
}

export async function writeCacheBatch(
  hubId: string,
  tipo: CacheTipo,
  rows: Array<{ fecha: string; datos: unknown }>,
): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    hub_id: hubId,
    tipo,
    fecha: r.fecha,
    datos: r.datos as never,
    calculado_en: new Date().toISOString(),
  }));
  const chunk = 500;
  for (let i = 0; i < payload.length; i += chunk) {
    const { error } = await supabase
      .from("hub_daily_cache")
      .upsert(payload.slice(i, i + chunk), { onConflict: "hub_id,fecha,tipo" });
    if (error) throw error;
  }
}
