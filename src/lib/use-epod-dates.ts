import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Fechas distintas con ePOD subido para un hub — usado por cualquier reporte
// que necesite un selector de Día contra la base (Mapa de Entregas, Flow
// Meeting, Paquetes en Riesgo, etc.).
//
// Consulta directa (SELECT normal), sin función RPC de Postgres: ya tuvimos
// más de un caso de funciones que quedaron en el código pero nunca llegaron
// a aplicarse en producción (epod_available_dates, has_all_hub_access), lo
// que costó tiempo diagnosticar. Una consulta directa al cliente de Supabase
// no depende de ninguna migración de función — solo de que la tabla/columna
// exista (ya confirmado).
//
// Paginación: primero se pide el conteo exacto (head:true, sin traer filas)
// para saber cuántas páginas de 1000 (el tope por defecto de PostgREST)
// hacen falta, y luego se piden TODAS en paralelo con Promise.all en vez de
// un loop secuencial — con hubs de decenas de miles de filas, esto es la
// diferencia entre varias decenas de esperas en fila y una sola espera.
const PAGE_SIZE = 1000;

export function useEpodDates(hubId: string | null) {
  return useQuery({
    queryKey: ["epod-dates", hubId],
    queryFn: async () => {
      if (!hubId) return [] as string[];

      const { count, error: countError } = await supabase
        .from("epod_lineas")
        .select("fecha", { count: "exact", head: true })
        .eq("hub_id", hubId)
        .not("fecha", "is", null);
      if (countError) throw countError;

      const total = count ?? 0;
      const pageCount = Math.ceil(total / PAGE_SIZE);
      const pages = await Promise.all(
        Array.from({ length: pageCount }, (_, i) => {
          const from = i * PAGE_SIZE;
          return supabase
            .from("epod_lineas")
            .select("fecha")
            .eq("hub_id", hubId)
            .not("fecha", "is", null)
            .order("fecha", { ascending: false })
            .range(from, from + PAGE_SIZE - 1);
        })
      );

      const seen = new Set<string>();
      const dates: string[] = [];
      for (const { data, error } of pages) {
        if (error) throw error;
        for (const row of data ?? []) {
          const fecha = row.fecha;
          if (fecha && !seen.has(fecha)) {
            seen.add(fecha);
            dates.push(fecha);
          }
        }
      }
      dates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
      return dates;
    },
    enabled: !!hubId,
    staleTime: 5 * 60 * 1000,
  });
}
