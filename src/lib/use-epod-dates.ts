import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Fechas distintas con ePOD subido para un hub — usado por cualquier reporte
// que necesite un selector de Día contra la base (Mapa de Entregas, Flow
// Meeting, Paquetes en Riesgo, etc.).
//
// OJO: esto antes leía epod_uploads.fecha_epod (una fila por subida), pero
// ese campo NO es "la fecha de esa subida" — es el Task Date MÍNIMO
// encontrado en todo el archivo subido (ver epod.tsx: `dates.sort();
// fecha_epod = dates[0]`). Como un ePOD normalmente trae muchos días de
// historial por waybill (necesario para calcular T0), eso colapsaba cada
// subida a un solo día casi siempre viejo, dejando fuera la inmensa mayoría
// de fechas reales — el selector mostraba 1-2 días en vez de todos, y al
// elegir esa fecha rara el mapa/reporte solo encontraba un puñado de filas.
// Ahora se leen las fechas reales de epod_lineas vía epod_available_dates().
export function useEpodDates(hubId: string | null) {
  return useQuery({
    queryKey: ["epod-dates", hubId],
    queryFn: async () => {
      if (!hubId) return [] as string[];
      const { data, error } = await supabase.rpc("epod_available_dates", { _hub_id: hubId });
      if (error) throw error;
      return (data ?? []) as string[];
    },
    enabled: !!hubId,
  });
}
