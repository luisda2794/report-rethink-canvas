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
// exista (ya confirmado). Se pagina en páginas de 1000 (el tope por defecto
// de PostgREST) para no perder fechas si el hub tiene muchas filas, y se
// deduplica en el frontend con un Set.
export function useEpodDates(hubId: string | null) {
  return useQuery({
    queryKey: ["epod-dates", hubId],
    queryFn: async () => {
      if (!hubId) return [] as string[];
      const pageSize = 1000;
      const seen = new Set<string>();
      const dates: string[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("epod_lineas")
          .select("fecha")
          .eq("hub_id", hubId)
          .not("fecha", "is", null)
          .order("fecha", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = data ?? [];
        for (const row of page) {
          const fecha = row.fecha;
          if (fecha && !seen.has(fecha)) {
            seen.add(fecha);
            dates.push(fecha);
          }
        }
        if (page.length < pageSize) break;
      }
      return dates;
    },
    enabled: !!hubId,
  });
}
