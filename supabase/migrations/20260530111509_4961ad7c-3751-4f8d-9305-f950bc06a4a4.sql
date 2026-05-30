CREATE TABLE IF NOT EXISTS public.entregas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hub_id uuid REFERENCES public.hubs(id) ON DELETE CASCADE NOT NULL,
  lp_no text NOT NULL,
  waybill text,
  driver text,
  fecha date,
  fecha_inbound date,
  cp text,
  tipo text,
  estado text NOT NULL DEFAULT 'entregado',
  source text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (hub_id, lp_no)
);

CREATE INDEX IF NOT EXISTS idx_entregas_hub_fecha ON public.entregas(hub_id, fecha);
CREATE INDEX IF NOT EXISTS idx_entregas_driver ON public.entregas(driver);
CREATE INDEX IF NOT EXISTS idx_entregas_cp ON public.entregas(cp);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entregas TO authenticated;
GRANT ALL ON public.entregas TO service_role;

ALTER TABLE public.entregas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entregas_read" ON public.entregas FOR SELECT TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = entregas.hub_id
));
CREATE POLICY "entregas_insert" ON public.entregas FOR INSERT TO authenticated
WITH CHECK (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = entregas.hub_id
));
CREATE POLICY "entregas_update" ON public.entregas FOR UPDATE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = entregas.hub_id
));
CREATE POLICY "entregas_delete" ON public.entregas FOR DELETE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = entregas.hub_id
));

CREATE TRIGGER touch_entregas_updated_at
BEFORE UPDATE ON public.entregas
FOR EACH ROW EXECUTE FUNCTION public.touch_reclamaciones_updated_at();