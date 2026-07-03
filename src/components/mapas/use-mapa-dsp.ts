import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CpFeatureCollection } from "@/components/mapas/types";

// Override these in your .env (or in the Lovable Cloud secrets) if your bucket
// or file path differs. Defaults match the convention we agreed on.
const BUCKET = import.meta.env.VITE_MAPAS_BUCKET ?? "mapas";
const PATH = import.meta.env.VITE_MAPA_ALICANTE_PATH ?? "alicante.geojson";

export type MapaDspMeta = {
  totalCp: number;
  totalVolumen: number;
};

export type MapaDspData = {
  geojson: CpFeatureCollection;
  meta: MapaDspMeta;
};

async function fetchMapaDsp(): Promise<MapaDspData> {
  // 1. Try the typed Supabase Storage SDK first (works whether the bucket is
  //    public or private — falls back to download() if not public).
  let blob: Blob | null = null;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(PATH);
    if (!error && data) blob = data;
  } catch {
    // fall through to public URL
  }

  // 2. If that didn't work, try the public URL directly.
  if (!blob) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(PATH);
    const res = await fetch(data.publicUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(
        `No se pudo cargar el mapa desde storage://${BUCKET}/${PATH} (${res.status}). ` +
          `¿Existe el archivo y el bucket es público?`,
      );
    }
    blob = await res.blob();
  }

  const text = await blob.text();
  const geojson = JSON.parse(text) as CpFeatureCollection;

  let totalVolumen = 0;
  for (const f of geojson.features) {
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
    queryKey: ["mapa-dsp", BUCKET, PATH],
    queryFn: fetchMapaDsp,
    staleTime: 5 * 60 * 1000,
  });
}
