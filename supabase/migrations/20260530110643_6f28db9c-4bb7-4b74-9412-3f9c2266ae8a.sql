CREATE TABLE IF NOT EXISTS public.facturas_cainiao (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hub_id uuid REFERENCES public.hubs(id) ON DELETE CASCADE NOT NULL,
  user_id uuid,
  bill_id text,
  filename text,
  fecha_factura date,
  total_paquetes integer NOT NULL DEFAULT 0,
  pagados integer NOT NULL DEFAULT 0,
  no_pagados integer NOT NULL DEFAULT 0,
  importe_total numeric(10,2) NOT NULL DEFAULT 0,
  importe_estimado_no_cobrado numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.facturas_cainiao TO authenticated;
GRANT ALL ON public.facturas_cainiao TO service_role;

ALTER TABLE public.facturas_cainiao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "facturas_read" ON public.facturas_cainiao FOR SELECT TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = facturas_cainiao.hub_id
));
CREATE POLICY "facturas_insert" ON public.facturas_cainiao FOR INSERT TO authenticated
WITH CHECK (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = facturas_cainiao.hub_id
));
CREATE POLICY "facturas_update" ON public.facturas_cainiao FOR UPDATE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = facturas_cainiao.hub_id
));
CREATE POLICY "facturas_delete" ON public.facturas_cainiao FOR DELETE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = facturas_cainiao.hub_id
));

CREATE TABLE IF NOT EXISTS public.conciliacion (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hub_id uuid REFERENCES public.hubs(id) ON DELETE CASCADE NOT NULL,
  factura_id uuid REFERENCES public.facturas_cainiao(id) ON DELETE CASCADE,
  lp_no text NOT NULL,
  waybill text,
  driver text,
  fecha date,
  cp text,
  tipo text,
  pagado boolean NOT NULL DEFAULT false,
  importe numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conciliacion_factura ON public.conciliacion(factura_id);
CREATE INDEX IF NOT EXISTS idx_conciliacion_hub ON public.conciliacion(hub_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conciliacion TO authenticated;
GRANT ALL ON public.conciliacion TO service_role;

ALTER TABLE public.conciliacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conciliacion_read" ON public.conciliacion FOR SELECT TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = conciliacion.hub_id
));
CREATE POLICY "conciliacion_insert" ON public.conciliacion FOR INSERT TO authenticated
WITH CHECK (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = conciliacion.hub_id
));
CREATE POLICY "conciliacion_update" ON public.conciliacion FOR UPDATE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = conciliacion.hub_id
));
CREATE POLICY "conciliacion_delete" ON public.conciliacion FOR DELETE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = conciliacion.hub_id
));