
CREATE TABLE IF NOT EXISTS public.reclamaciones (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hub_id uuid REFERENCES public.hubs(id) ON DELETE CASCADE NOT NULL,
  ref text NOT NULL DEFAULT '',
  waybill text,
  lp_no text,
  driver_nombre text,
  driver_telefono text,
  fecha_entrega date,
  tipo text NOT NULL,
  importe numeric(10,2) DEFAULT 0,
  cp text,
  comentarios text,
  evidencia text,
  estado text NOT NULL DEFAULT 'abierta'
    CHECK (estado IN ('abierta','enviada_driver','respondida_driver','en_proceso','resuelta')),
  token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  respuesta_driver text,
  evidencia_driver text,
  nombre_driver_resp text,
  fecha_envio_whatsapp timestamp with time zone,
  fecha_respuesta timestamp with time zone,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.reclamaciones_seq START 1;

CREATE OR REPLACE FUNCTION public.gen_rec_ref()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ref IS NULL OR NEW.ref = '' THEN
    NEW.ref := 'REC-' || LPAD(nextval('public.reclamaciones_seq')::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_rec_ref ON public.reclamaciones;
CREATE TRIGGER set_rec_ref
  BEFORE INSERT ON public.reclamaciones
  FOR EACH ROW
  EXECUTE FUNCTION public.gen_rec_ref();

CREATE OR REPLACE FUNCTION public.touch_reclamaciones_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_reclamaciones ON public.reclamaciones;
CREATE TRIGGER touch_reclamaciones
  BEFORE UPDATE ON public.reclamaciones
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_reclamaciones_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reclamaciones TO authenticated;
GRANT ALL ON public.reclamaciones TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.reclamaciones_seq TO authenticated, service_role;

ALTER TABLE public.reclamaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reclamaciones_read"
ON public.reclamaciones
FOR SELECT
TO authenticated
USING (
  public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.usuario_hubs
    WHERE user_id = auth.uid() AND hub_id = reclamaciones.hub_id
  )
);

CREATE POLICY "reclamaciones_insert"
ON public.reclamaciones
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.usuario_hubs
    WHERE user_id = auth.uid() AND hub_id = reclamaciones.hub_id
  )
);

CREATE POLICY "reclamaciones_update"
ON public.reclamaciones
FOR UPDATE
TO authenticated
USING (
  public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.usuario_hubs
    WHERE user_id = auth.uid() AND hub_id = reclamaciones.hub_id
  )
);

CREATE POLICY "reclamaciones_delete"
ON public.reclamaciones
FOR DELETE
TO authenticated
USING (
  public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.usuario_hubs
    WHERE user_id = auth.uid() AND hub_id = reclamaciones.hub_id
  )
);

ALTER TABLE public.reclamaciones REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.reclamaciones;

INSERT INTO storage.buckets (id, name, public)
VALUES ('rec-evidencias', 'rec-evidencias', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "rec_evidencias_public_read" ON storage.objects;
CREATE POLICY "rec_evidencias_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'rec-evidencias');

DROP POLICY IF EXISTS "rec_evidencias_public_insert" ON storage.objects;
CREATE POLICY "rec_evidencias_public_insert"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'rec-evidencias');
