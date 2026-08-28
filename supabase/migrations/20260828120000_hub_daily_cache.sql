-- Caché precalculada de reportes pesados (CD5, Flow Meeting, Paquetes en
-- Riesgo) por hub+fecha. Se llena de forma incremental justo después de
-- cada subida de ePOD (ver /epod) y bajo demanda (lectura con fallback: si
-- falta o no aplica, el reporte calcula en vivo como ya hace hoy y escribe
-- el resultado acá) — nunca es una dependencia dura, solo una optimización.
CREATE TABLE IF NOT EXISTS public.hub_daily_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  tipo text NOT NULL, -- 'cd5' | 'flow_meeting' | 'paquetes_en_riesgo'
  datos jsonb NOT NULL,
  calculado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, fecha, tipo)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_daily_cache TO authenticated;
GRANT ALL ON public.hub_daily_cache TO service_role;
ALTER TABLE public.hub_daily_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_daily_cache_read" ON public.hub_daily_cache FOR SELECT TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = hub_daily_cache.hub_id));

CREATE POLICY "hub_daily_cache_insert" ON public.hub_daily_cache FOR INSERT TO authenticated
WITH CHECK (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = hub_daily_cache.hub_id));

CREATE POLICY "hub_daily_cache_update" ON public.hub_daily_cache FOR UPDATE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = hub_daily_cache.hub_id));

CREATE POLICY "hub_daily_cache_delete" ON public.hub_daily_cache FOR DELETE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = hub_daily_cache.hub_id));

-- Lectura típica: "las últimas N fechas cacheadas de este tipo para el hub",
-- o "la fecha más reciente" — ambas ordenan por fecha DESC, no calculado_en
-- (un recálculo masivo de historial viejo no debe parecer "lo más reciente").
CREATE INDEX IF NOT EXISTS idx_hub_daily_cache_lookup ON public.hub_daily_cache(hub_id, tipo, fecha DESC);
