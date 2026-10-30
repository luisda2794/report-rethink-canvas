import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Paquetes en riesgo CD5/CD9 por horas. Todo el cálculo vive en la función
// SQL riesgo_cd_stats (RLS por hub): inbound = MIN(inbound_at), límite =
// inbound + 120 h (Local) / 216 h (China), reglas R0–R7 fuera de target.

export type Grupo = "roto" | "hoy" | "manana";

export type PaqueteRiesgo = {
  id: string;
  waybill: string | null;
  origen: "China" | "Local";
  metrica: "CD5" | "CD9";
  grupo: Grupo;
  inbound_at: string;
  limite: string;
  horas: number;
  ultimo_estado: string | null;
  intentos: number;
  ultimo_motivo: string | null;
  tipo: string | null;
  pudo: string | null;
  cp: string | null;
  ciudad: string | null;
  direccion: string | null;
  driver: string | null;
};

export type FueraTarget = {
  id: string;
  regla: string;
  origen: "China" | "Local";
  inbound_at: string;
  ultimo_estado: string | null;
  ultimo_motivo: string | null;
  cp: string | null;
  driver: string | null;
};

export type RiesgoResult = {
  ahora: string;
  sin_horas: boolean;
  paquetes: PaqueteRiesgo[];
  fuera_target: FueraTarget[];
};

export const REGLAS: Record<string, string> = {
  R0: "Devolución a puerta (DELIVERY_TO_DOOR_RETURN)",
  R1: "Una sola tarea Cancel/Assigned (nunca llegó)",
  R2: "CP excluido del hub",
  R3: "Return to seller sin entrega",
  R4: "Cancel/Attempt Failure y 7+ días sin tareas",
  R5: "Dirección incorrecta",
  R6: "Fuera de mi Ruta",
  R7: "Rechazado por el Cliente",
};

export function useRiesgo(hubId: string | null) {
  return useQuery({
    queryKey: ["riesgo-cd", hubId],
    enabled: !!hubId,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<RiesgoResult> => {
      const { data, error } = await supabase.rpc("riesgo_cd_stats", { _hub_id: hubId as string });
      if (error) throw error;
      return data as unknown as RiesgoResult;
    },
  });
}
