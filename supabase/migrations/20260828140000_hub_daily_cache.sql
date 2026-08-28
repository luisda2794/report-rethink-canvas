-- Caché precalculada de reportes pesados por hub+fecha (misma tabla genérica
-- de antes — soporta 'tipo' = 'cd5' | 'flow_meeting' | 'paquetes_en_riesgo'
-- para poder ir agregando cada reporte de a uno, sin re-migrar cada vez).
-- Este round SOLO activa Flow Meeting en el código; CD5/DSR/Riesgo se suman
-- en rounds siguientes una vez confirmado que este funciona sin regresiones.
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

CREATE INDEX IF NOT EXISTS idx_hub_daily_cache_lookup ON public.hub_daily_cache(hub_id, tipo, fecha DESC);

-- Fuerza a PostgREST a refrescar su caché de esquema ya mismo, en vez de
-- esperar a que lo note solo — evita el PGRST205 ("could not find table in
-- schema cache") si algo prueba la tabla nueva justo después de aplicar esto.
NOTIFY pgrst, 'reload schema';
