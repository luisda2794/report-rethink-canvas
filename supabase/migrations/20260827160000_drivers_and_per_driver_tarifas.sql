-- Reactivación de Drivers + Facturación (spec nueva): las tarifas dejan de
-- ser por (hub, CP) compartidas entre todos los drivers del hub, y pasan a
-- ser por (driver, CP) — cada driver puede tener su propio precio para el
-- mismo CP. Se introduce una tabla `drivers` real (antes el "driver" era
-- solo texto libre traído del ePOD, sin entidad propia).

CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, nombre)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.drivers TO authenticated;
GRANT ALL ON public.drivers TO service_role;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drivers_read" ON public.drivers FOR SELECT TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = drivers.hub_id));

CREATE POLICY "drivers_insert" ON public.drivers FOR INSERT TO authenticated
WITH CHECK (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = drivers.hub_id));

CREATE POLICY "drivers_update" ON public.drivers FOR UPDATE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = drivers.hub_id));

CREATE POLICY "drivers_delete" ON public.drivers FOR DELETE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = drivers.hub_id));

CREATE TRIGGER touch_drivers_updated_at BEFORE UPDATE ON public.drivers
FOR EACH ROW EXECUTE FUNCTION public.touch_reclamaciones_updated_at();

CREATE INDEX IF NOT EXISTS idx_drivers_hub ON public.drivers(hub_id);

-- driver_tarifas pasa de única por (hub_id, codigo_postal) a única por
-- (driver_id, codigo_postal). driver_id se agrega NULLABLE a propósito: si
-- ya existen tarifas antiguas (por hub, sin driver asignado) en producción,
-- esta migración NO las borra ni las reasigna automáticamente — quedarían
-- con driver_id NULL, visibles pero "huérfanas", hasta que se reasignen a
-- mano a un driver concreto. Antes de aplicar esto en producción, revisa:
--   SELECT count(*) FROM driver_tarifas WHERE driver_id IS NULL;
-- (después de esta migración) para saber si hay tarifas viejas que migrar.
ALTER TABLE public.driver_tarifas
  ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES public.drivers(id) ON DELETE CASCADE;

ALTER TABLE public.driver_tarifas
  DROP CONSTRAINT IF EXISTS driver_tarifas_hub_id_codigo_postal_key;

-- Constraint normal (no índice parcial): con driver_id nulo, Postgres trata
-- cada NULL como distinto de los demás, así que las filas huérfanas viejas
-- (driver_id NULL) nunca chocan entre sí. Además, un índice parcial no sirve
-- como target de ON CONFLICT para el upsert de PostgREST (que genera
-- `ON CONFLICT (driver_id, codigo_postal)` sin cláusula WHERE) — con este
-- constraint normal, el upsert por (driver_id, codigo_postal) funciona bien
-- una vez que driver_id está seteado.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'driver_tarifas_driver_cp_key'
  ) THEN
    ALTER TABLE public.driver_tarifas
      ADD CONSTRAINT driver_tarifas_driver_cp_key UNIQUE (driver_id, codigo_postal);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_driver_tarifas_driver ON public.driver_tarifas(driver_id);
