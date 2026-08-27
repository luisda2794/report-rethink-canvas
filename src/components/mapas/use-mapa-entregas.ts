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

// Consulta directa (sin RPC), paginada en páginas de 1000 (el tope por
// defecto de PostgREST) para traer TODAS las filas del día sin ningún límite
// artificial — un hub puede mover fácilmente varios miles de paquetes en un
// solo día.
const PAGE_SIZE = 1000;

export function useEpodLineasForDay(hubId: string | null, fecha: string | null) {
  return useQuery({
    queryKey: ["mapa-entregas-lineas", hubId, fecha],
    queryFn: async () => {
      if (!hubId || !fecha) return [] as EpodLineaRow[];
      const allRows: EpodLineaRow[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("epod_lineas")
          .select("id, waybill, lp_no, estado, cp, direccion, driver, latitude, longitude, exception_detail")
          .eq("hub_id", hubId)
          .eq("fecha", fecha)
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        const page = (data ?? []) as EpodLineaRow[];
        allRows.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      return allRows;
    },
    enabled: !!hubId && !!fecha,
  });
}
