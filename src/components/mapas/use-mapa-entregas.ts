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

// Consulta directa (sin RPC), solo las columnas que el mapa/los contadores
// realmente usan.
//
// Paginación: primero se pide el conteo exacto (head:true, sin traer filas)
// para saber cuántas páginas de 1000 (el tope por defecto de PostgREST)
// hacen falta, y luego se piden TODAS en paralelo con Promise.all en vez de
// un loop secuencial de awaits — un hub puede mover varios miles de paquetes
// en un solo día, y eso antes significaba varias decenas de esperas en fila.
// Se ordena por id para que range() sea determinístico entre páginas
// paralelas (sin ORDER BY, Postgres no garantiza el mismo orden entre
// llamadas separadas, lo que podría duplicar o saltarse filas al paginar).
const PAGE_SIZE = 1000;
const COLUMNS = "id, waybill, lp_no, estado, cp, direccion, driver, latitude, longitude, exception_detail";

export function useEpodLineasForDay(hubId: string | null, fecha: string | null) {
  return useQuery({
    queryKey: ["mapa-entregas-lineas", hubId, fecha],
    queryFn: async () => {
      if (!hubId || !fecha) return [] as EpodLineaRow[];

      const { count, error: countError } = await supabase
        .from("epod_lineas")
        .select("id", { count: "exact", head: true })
        .eq("hub_id", hubId)
        .eq("fecha", fecha);
      if (countError) throw countError;

      const total = count ?? 0;
      const pageCount = Math.ceil(total / PAGE_SIZE);
      const pages = await Promise.all(
        Array.from({ length: pageCount }, (_, i) => {
          const from = i * PAGE_SIZE;
          return supabase
            .from("epod_lineas")
            .select(COLUMNS)
            .eq("hub_id", hubId)
            .eq("fecha", fecha)
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);
        })
      );

      const allRows: EpodLineaRow[] = [];
      for (const { data, error } of pages) {
        if (error) throw error;
        allRows.push(...((data ?? []) as EpodLineaRow[]));
      }
      return allRows;
    },
    enabled: !!hubId && !!fecha,
    staleTime: 5 * 60 * 1000,
  });
}
