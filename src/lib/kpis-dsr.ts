import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// DSR = Entregados ÷ (Entregados + Attempt Failure), ya calculado en SQL por
// dashboard_dsr_stats() (mismo RPC que usa el Dashboard) sobre epod_lineas,
// con la fecha real del evento (tiempo_entrega/tiempo_fracaso, fallback a
// fecha). Se reutiliza tal cual acá en vez de duplicar la lógica — a
// diferencia de CD5, este RPC ya existe, ya está en producción (el Dashboard
// depende de él hoy) y no hace falta tocarlo.
//
// _window_days: el buffer interno del RPC trae 28 días de calendario hacia
// atrás, que alcanzan para exactamente 20 días hábiles (4 semanas × 5) — por
// eso las tendencias de esta página piden 20, no 30: pedir más devolvería
// silenciosamente menos días de los pedidos sin tocar el RPC compartido con
// el Dashboard.
export const KPIS_TREND_BUSINESS_DAYS = 20;

type DsrDayAgg = { fecha: string; delivered: number; failed: number };

export type DsrDayPoint = {
  fecha: string;
  delivered: number;
  failed: number;
  total: number;
  dsr: number | null;
};

export function useDsrTrend(hubId: string | null, windowDays: number = KPIS_TREND_BUSINESS_DAYS) {
  return useQuery({
    queryKey: ["kpis-dsr-trend", hubId, windowDays],
    enabled: !!hubId,
    staleTime: 60_000,
    queryFn: async (): Promise<DsrDayPoint[]> => {
      const { data, error } = await supabase.rpc("dashboard_dsr_stats", {
        _hub_ids: [hubId],
        _include_weekends: false,
        _window_days: windowDays,
      });
      if (error) throw error;
      const trend = ((data as { trend?: DsrDayAgg[] } | null)?.trend ?? []);
      return trend.map((d) => {
        const total = d.delivered + d.failed;
        return { fecha: d.fecha, delivered: d.delivered, failed: d.failed, total, dsr: total > 0 ? (d.delivered / total) * 100 : null };
      });
    },
  });
}
