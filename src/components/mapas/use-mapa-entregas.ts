import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// useEpodDates ahora vive en @/lib/use-epod-dates (compartido entre Mapa de
// Entregas, Flow Meeting y el resto de reportes de la Fase 4) — se re-exporta
// acá para no romper el import existente.
export { useEpodDates } from "@/lib/use-epod-dates";

export type EpodLineaRow = {
  id: string;
  waybill: string | null;
  lp_no: string;
  estado: string;
  cp: string | null;
  direccion: string | null;
  driver: string | null;
  latitude: number | null;
  longitude: number | null;
  exception_detail: string | null;
};

// Tope defensivo: un día normal de un hub no debería acercarse a esto, pero
// evita pedir una página infinita si algún día trae muchísimas filas.
const MAX_ROWS = 5000;

export function useEpodLineasForDay(hubId: string | null, fecha: string | null) {
  return useQuery({
    queryKey: ["mapa-entregas-lineas", hubId, fecha],
    queryFn: async () => {
      if (!hubId || !fecha) return [] as EpodLineaRow[];
      const { data, error } = await supabase
        .from("epod_lineas")
        .select("id, waybill, lp_no, estado, cp, direccion, driver, latitude, longitude, exception_detail")
        .eq("hub_id", hubId)
        .eq("fecha", fecha)
        .limit(MAX_ROWS);
      if (error) throw error;
      return (data ?? []) as EpodLineaRow[];
    },
    enabled: !!hubId && !!fecha,
  });
}
