-- "Situaciones Especiales": tarifa puntual para un driver+fecha+CP concreto,
-- que sobreescribe la tarifa normal (driver_tarifas) SOLO ese día — ej. un
-- driver que sale de apoyo a un CP ajeno con otra tarifa. Todos los campos
-- de tarifa son opcionales: si un campo queda vacío, se usa la tarifa normal
-- como respaldo para esa parte puntual (mismo criterio que ya usa
-- driver_tarifas para el resto de las tarifas).
CREATE TABLE IF NOT EXISTS public.situaciones_especiales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  codigo_postal text NOT NULL,
  tarifa_to_door numeric,
  tarifa_pudo_primero numeric,
  tarifa_pudo_extra numeric,
  precio_salida numeric, -- pago fijo adicional por salir a reparto ese día, si aplica
  nota text, -- ej. "Apoyo a Yenifer, ruta 3680"
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, fecha, codigo_postal)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.situaciones_especiales TO authenticated;
GRANT ALL ON public.situaciones_especiales TO service_role;
ALTER TABLE public.situaciones_especiales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "situaciones_especiales_read" ON public.situaciones_especiales FOR SELECT TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = situaciones_especiales.hub_id));

CREATE POLICY "situaciones_especiales_insert" ON public.situaciones_especiales FOR INSERT TO authenticated
WITH CHECK (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = situaciones_especiales.hub_id));

CREATE POLICY "situaciones_especiales_update" ON public.situaciones_especiales FOR UPDATE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = situaciones_especiales.hub_id));

CREATE POLICY "situaciones_especiales_delete" ON public.situaciones_especiales FOR DELETE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = situaciones_especiales.hub_id));

CREATE INDEX IF NOT EXISTS idx_situaciones_especiales_driver_fecha ON public.situaciones_especiales(driver_id, fecha);
CREATE INDEX IF NOT EXISTS idx_situaciones_especiales_hub_fecha ON public.situaciones_especiales(hub_id, fecha);

NOTIFY pgrst, 'reload schema';
