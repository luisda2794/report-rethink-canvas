
CREATE TABLE IF NOT EXISTS public.driver_tarifas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hub_id uuid REFERENCES public.hubs(id) ON DELETE CASCADE NOT NULL,
  codigo_postal text NOT NULL,
  precio_door numeric(10,4) NOT NULL DEFAULT 1.05,
  precio_pudo numeric(10,4) NOT NULL DEFAULT 0.30,
  precio_aa numeric(10,4) NOT NULL DEFAULT 0.30,
  vigente_desde date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, codigo_postal)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_tarifas TO authenticated;
GRANT ALL ON public.driver_tarifas TO service_role;
ALTER TABLE public.driver_tarifas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tarifas_read" ON public.driver_tarifas FOR SELECT TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = driver_tarifas.hub_id));

CREATE POLICY "tarifas_insert" ON public.driver_tarifas FOR INSERT TO authenticated
WITH CHECK (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = driver_tarifas.hub_id));

CREATE POLICY "tarifas_update" ON public.driver_tarifas FOR UPDATE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = driver_tarifas.hub_id));

CREATE POLICY "tarifas_delete" ON public.driver_tarifas FOR DELETE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = driver_tarifas.hub_id));

CREATE TRIGGER touch_driver_tarifas_updated_at BEFORE UPDATE ON public.driver_tarifas
FOR EACH ROW EXECUTE FUNCTION public.touch_reclamaciones_updated_at();


CREATE TABLE IF NOT EXISTS public.borradores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hub_id uuid REFERENCES public.hubs(id) ON DELETE CASCADE NOT NULL,
  driver_nombre text NOT NULL,
  fecha_desde date NOT NULL,
  fecha_hasta date NOT NULL,
  total_paquetes integer NOT NULL DEFAULT 0,
  base_imponible numeric(10,2) NOT NULL DEFAULT 0,
  iva_21 numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','confirmado','facturado')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.borradores TO authenticated;
GRANT ALL ON public.borradores TO service_role;
ALTER TABLE public.borradores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "borradores_read" ON public.borradores FOR SELECT TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = borradores.hub_id));

CREATE POLICY "borradores_insert" ON public.borradores FOR INSERT TO authenticated
WITH CHECK (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = borradores.hub_id));

CREATE POLICY "borradores_update" ON public.borradores FOR UPDATE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = borradores.hub_id));

CREATE POLICY "borradores_delete" ON public.borradores FOR DELETE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = borradores.hub_id));

CREATE TRIGGER touch_borradores_updated_at BEFORE UPDATE ON public.borradores
FOR EACH ROW EXECUTE FUNCTION public.touch_reclamaciones_updated_at();


CREATE TABLE IF NOT EXISTS public.borrador_lineas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  borrador_id uuid REFERENCES public.borradores(id) ON DELETE CASCADE NOT NULL,
  codigo_postal text NOT NULL,
  tipo_entrega text NOT NULL,
  cantidad integer NOT NULL DEFAULT 0,
  precio_unitario numeric(10,4) NOT NULL DEFAULT 0,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.borrador_lineas TO authenticated;
GRANT ALL ON public.borrador_lineas TO service_role;
ALTER TABLE public.borrador_lineas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "borrador_lineas_read" ON public.borrador_lineas FOR SELECT TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.borradores b JOIN public.usuario_hubs uh ON uh.hub_id = b.hub_id
  WHERE b.id = borrador_lineas.borrador_id AND uh.user_id = auth.uid()
));

CREATE POLICY "borrador_lineas_insert" ON public.borrador_lineas FOR INSERT TO authenticated
WITH CHECK (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.borradores b JOIN public.usuario_hubs uh ON uh.hub_id = b.hub_id
  WHERE b.id = borrador_lineas.borrador_id AND uh.user_id = auth.uid()
));

CREATE POLICY "borrador_lineas_update" ON public.borrador_lineas FOR UPDATE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.borradores b JOIN public.usuario_hubs uh ON uh.hub_id = b.hub_id
  WHERE b.id = borrador_lineas.borrador_id AND uh.user_id = auth.uid()
));

CREATE POLICY "borrador_lineas_delete" ON public.borrador_lineas FOR DELETE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.borradores b JOIN public.usuario_hubs uh ON uh.hub_id = b.hub_id
  WHERE b.id = borrador_lineas.borrador_id AND uh.user_id = auth.uid()
));

CREATE INDEX IF NOT EXISTS idx_driver_tarifas_hub ON public.driver_tarifas(hub_id);
CREATE INDEX IF NOT EXISTS idx_borradores_hub ON public.borradores(hub_id);
CREATE INDEX IF NOT EXISTS idx_borrador_lineas_borrador ON public.borrador_lineas(borrador_id);
