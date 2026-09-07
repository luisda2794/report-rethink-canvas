-- Equipo Operativo de agentes (Fase 1: los 6 trabajadores + panel de
-- observabilidad, disparados manualmente desde /agentes — el cron y el
-- Agente Jefe quedan para fases posteriores, ya confirmadas con el
-- usuario). Cada ejecución (manual por ahora) queda registrada acá para
-- que el panel muestre última corrida, hallazgos crudos e historial.
CREATE TABLE IF NOT EXISTS public.agente_ejecuciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente text NOT NULL CHECK (agente IN (
    'alertas_kpis','driver_riesgo','clasificador_reclamaciones',
    'resumen_ejecutivo','prequalificacion_leads','fraude_pudo'
  )),
  hub_id uuid REFERENCES public.hubs(id) ON DELETE CASCADE, -- null = corrida multi-hub
  ejecutado_en timestamptz NOT NULL DEFAULT now(),
  ejecutado_por uuid REFERENCES auth.users(id), -- null cuando pase a correr por cron
  exito boolean NOT NULL DEFAULT true,
  error text,
  hallazgos jsonb NOT NULL DEFAULT '[]'::jsonb,
  urgencia text CHECK (urgencia IN ('critica','informativa')),
  duracion_ms integer
);

-- Solo lectura para authenticated (admin/manager vía policy) — todo INSERT
-- lo hace el server function con la service role (mismo patrón que
-- mapas.functions.ts / reclamaciones-public.functions.ts), así que no hace
-- falta ninguna policy de escritura para authenticated.
GRANT SELECT ON public.agente_ejecuciones TO authenticated;
GRANT ALL ON public.agente_ejecuciones TO service_role;
ALTER TABLE public.agente_ejecuciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agente_ejecuciones_read" ON public.agente_ejecuciones FOR SELECT TO authenticated
USING (is_admin(auth.uid()) OR get_user_role(auth.uid()) = 'manager');

CREATE INDEX IF NOT EXISTS idx_agente_ejecuciones_agente_fecha ON public.agente_ejecuciones(agente, ejecutado_en DESC);
CREATE INDEX IF NOT EXISTS idx_agente_ejecuciones_hub ON public.agente_ejecuciones(hub_id);

NOTIFY pgrst, 'reload schema';
