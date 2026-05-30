-- Extend entregas with ePOD fields
ALTER TABLE public.entregas
  ADD COLUMN IF NOT EXISTS epod_upload_id uuid,
  ADD COLUMN IF NOT EXISTS tipo_norm text,
  ADD COLUMN IF NOT EXISTS es_aa boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS direccion text,
  ADD COLUMN IF NOT EXISTS pop_station_id text,
  ADD COLUMN IF NOT EXISTS contacto text;

CREATE INDEX IF NOT EXISTS idx_entregas_hub_fecha ON public.entregas (hub_id, fecha);
CREATE INDEX IF NOT EXISTS idx_entregas_driver ON public.entregas (driver);
CREATE INDEX IF NOT EXISTS idx_entregas_cp ON public.entregas (cp);
CREATE INDEX IF NOT EXISTS idx_entregas_estado ON public.entregas (estado);
CREATE INDEX IF NOT EXISTS idx_entregas_lp ON public.entregas (lp_no);

-- ePOD uploads registry
CREATE TABLE IF NOT EXISTS public.epod_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  filename text NOT NULL,
  fecha_epod date,
  total_paquetes integer NOT NULL DEFAULT 0,
  total_entregados integer NOT NULL DEFAULT 0,
  total_duplicados integer NOT NULL DEFAULT 0,
  procesado boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.epod_uploads TO authenticated;
GRANT ALL ON public.epod_uploads TO service_role;

ALTER TABLE public.epod_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "epod_uploads_read" ON public.epod_uploads
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.usuario_hubs
      WHERE user_id = auth.uid() AND hub_id = epod_uploads.hub_id
    )
  );

CREATE POLICY "epod_uploads_insert" ON public.epod_uploads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.usuario_hubs
      WHERE user_id = auth.uid() AND hub_id = epod_uploads.hub_id
    )
  );

CREATE POLICY "epod_uploads_update" ON public.epod_uploads
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.usuario_hubs
      WHERE user_id = auth.uid() AND hub_id = epod_uploads.hub_id
    )
  );

CREATE POLICY "epod_uploads_delete" ON public.epod_uploads
  FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.usuario_hubs
      WHERE user_id = auth.uid() AND hub_id = epod_uploads.hub_id
    )
  );
