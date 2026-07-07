CREATE TABLE public.epod_lineas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  epod_upload_id uuid REFERENCES public.epod_uploads(id) ON DELETE CASCADE,
  row_index integer NOT NULL,
  lp_no text NOT NULL,
  waybill text,
  driver text,
  fecha date,
  fecha_inbound date,
  cp text,
  direccion text,
  contacto text,
  tipo text,
  tipo_norm text,
  estado text NOT NULL DEFAULT 'Desconocido',
  pop_station_id text,
  source text DEFAULT 'epod',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.epod_lineas TO authenticated;
GRANT ALL ON public.epod_lineas TO service_role;

ALTER TABLE public.epod_lineas ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_epod_lineas_hub_fecha ON public.epod_lineas(hub_id, fecha);
CREATE INDEX idx_epod_lineas_upload ON public.epod_lineas(epod_upload_id);
CREATE INDEX idx_epod_lineas_waybill ON public.epod_lineas(waybill);
CREATE INDEX idx_epod_lineas_lp ON public.epod_lineas(lp_no);

CREATE POLICY "epod_lineas_read" ON public.epod_lineas
FOR SELECT TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.usuario_hubs WHERE user_id = auth.uid() AND hub_id = epod_lineas.hub_id
));

CREATE POLICY "epod_lineas_insert" ON public.epod_lineas
FOR INSERT TO authenticated
WITH CHECK (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.usuario_hubs WHERE user_id = auth.uid() AND hub_id = epod_lineas.hub_id
));

CREATE POLICY "epod_lineas_delete" ON public.epod_lineas
FOR DELETE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.usuario_hubs WHERE user_id = auth.uid() AND hub_id = epod_lineas.hub_id
));