import { supabase } from "@/integrations/supabase/client";

// Caché de reportes pesados por hub+fecha (ver migración hub_daily_cache).
// Estas funciones son primitivas de lectura/escritura puras — nunca deciden
// solas si algo está "fresco": cada hook de reporte decide su propia regla
// de staleness (CD5/Flow Meeting: ¿está la fecha pedida?; Paquetes en
// Riesgo: ¿coincide con la fecha más reciente real en epod_lineas?) y cae a
// cálculo en vivo + escribe acá como efecto secundario si no.
export type CacheTipo = "cd5" | "flow_meeting" | "paquetes_en_riesgo";

export async function readCacheOne<T>(hubId: string, tipo: CacheTipo, fecha: string): Promise<T | null> {
  const { data, error } = await supabase
    .from("hub_daily_cache")
    .select("datos")
    .eq("hub_id", hubId)
    .eq("tipo", tipo)
    .eq("fecha", fecha)
    .maybeSingle();
  if (error) throw error;
  return (data?.datos as T | undefined) ?? null;
}

export async function readCacheLatest<T>(hubId: string, tipo: CacheTipo): Promise<{ fecha: string; datos: T } | null> {
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
}

export async function readCacheRange<T>(hubId: string, tipo: CacheTipo, fechas: string[]): Promise<Map<string, T>> {
  const map = new Map<string, T>();
  if (fechas.length === 0) return map;
  const { data, error } = await supabase
    .from("hub_daily_cache")
    .select("fecha, datos")
    .eq("hub_id", hubId)
    .eq("tipo", tipo)
    .in("fecha", fechas);
  if (error) throw error;
  for (const row of data ?? []) map.set(row.fecha, row.datos as T);
  return map;
}

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
