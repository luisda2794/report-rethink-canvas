import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getActiveMapaVersion } from "@/lib/mapas.functions";
import type { CpFeatureCollection, CpProperties } from "@/components/mapas/types";

export type MapaDspMeta = {
  totalCp: number;
  totalVolumen: number;
};

export type MapaDspData = {
  geojson: CpFeatureCollection;
  meta: MapaDspMeta;
};

const FALLBACK_PATH = "alicante.geojson";

async function downloadGeojson(path: string): Promise<CpFeatureCollection> {
  const { data, error } = await supabase.storage.from("mapas").download(path);
  if (!data || error) {
    throw new Error(
      `No se pudo descargar el GeoJSON (${path}): ${error?.message ?? "archivo no encontrado"}`,
    );
  }
  const text = await data.text();
  return JSON.parse(text) as CpFeatureCollection;
}

async function fetchMapaDsp(): Promise<MapaDspData> {
  let geojson: CpFeatureCollection;
  let cpData: Awaited<ReturnType<typeof getActiveMapaVersion>>["cpData"] = [];

  try {
    const active = await getActiveMapaVersion();
    geojson = await downloadGeojson(active.version.geojson_path);
    cpData = active.cpData;
  } catch {
    // Fallback: si no hay versión activa, usamos el archivo GeoJSON estático.
    geojson = await downloadGeojson(FALLBACK_PATH);
  }

  const overrides = new Map<string, Partial<CpProperties>>();
  for (const row of cpData) {
    overrides.set(row.cp, {
      dsp: row.dsp ?? undefined,
      hub: row.hub_id ?? undefined,
      sla_teorico: row.sla_teorico ?? undefined,
      sla_fijo: row.sla_fijo ?? undefined,
      volumen: row.volumen ?? undefined,
    });
  }

  let totalVolumen = 0;
  for (const f of geojson.features) {
    const cp = f.properties?.cp;
    if (cp && overrides.has(cp)) {
      const o = overrides.get(cp)!;
      f.properties = { ...f.properties, ...o };
    }
    totalVolumen += Number(f.properties?.volumen ?? 0);
  }

  return {
    geojson,
    meta: {
      totalCp: geojson.features.length,
      totalVolumen,
    },
  };
}

export function useMapaDsp() {
  return useQuery({
    queryKey: ["mapa-dsp", "active"],
    queryFn: fetchMapaDsp,
    staleTime: 5 * 60 * 1000,
  });
}

