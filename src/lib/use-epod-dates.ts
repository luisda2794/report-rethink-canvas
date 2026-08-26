import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Fechas distintas con ePOD subido para un hub — usado por cualquier reporte
// que necesite un selector de Día contra la base (Mapa de Entregas, Flow
// Meeting, Paquetes en Riesgo, etc.). Se leen de epod_uploads.fecha_epod (una
// fila por subida) en vez de SELECT DISTINCT sobre epod_lineas, que sería
// mucho más caro.
export function useEpodDates(hubId: string | null) {
  return useQuery({
    queryKey: ["epod-dates", hubId],
    queryFn: async () => {
      if (!hubId) return [] as string[];
      const { data, error } = await supabase
        .from("epod_uploads")
        .select("fecha_epod")
        .eq("hub_id", hubId)
        .not("fecha_epod", "is", null)
        .order("fecha_epod", { ascending: false });
      if (error) throw error;
      const seen = new Set<string>();
      const dates: string[] = [];
      for (const row of data ?? []) {
        const fecha = row.fecha_epod;
        if (fecha && !seen.has(fecha)) {
          seen.add(fecha);
          dates.push(fecha);
        }
      }
      return dates;
    },
    enabled: !!hubId,
  });
}
