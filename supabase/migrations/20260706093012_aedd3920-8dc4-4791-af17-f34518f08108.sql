CREATE TABLE public.mapa_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre text NOT NULL,
  geojson_path text NOT NULL,
  activa boolean NOT NULL DEFAULT false,
  creado_por uuid NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mapa_versions TO authenticated;
GRANT ALL ON public.mapa_versions TO service_role;

ALTER TABLE public.mapa_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin y manager gestionan versiones"
ON public.mapa_versions
FOR ALL
TO authenticated
USING (public.get_user_role(auth.uid()) IN ('admin', 'manager'))
WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'manager'));

CREATE POLICY "Resto de roles leen versiones"
ON public.mapa_versions
FOR SELECT
TO authenticated
USING (true);

CREATE TABLE public.mapa_cp_data (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES public.mapa_versions(id) ON DELETE CASCADE,
  cp text NOT NULL,
  dsp text,
  hub_id uuid REFERENCES public.hubs(id) ON DELETE SET NULL,
  sla_teorico text,
  sla_fijo text,
  volumen numeric,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (version_id, cp)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mapa_cp_data TO authenticated;
GRANT ALL ON public.mapa_cp_data TO service_role;

ALTER TABLE public.mapa_cp_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin y manager gestionan datos por CP"
ON public.mapa_cp_data
FOR ALL
TO authenticated
USING (public.get_user_role(auth.uid()) IN ('admin', 'manager'))
WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'manager'));

CREATE POLICY "Resto de roles leen datos por CP"
ON public.mapa_cp_data
FOR SELECT
TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.touch_mapa_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER mapa_versions_updated_at
BEFORE UPDATE ON public.mapa_versions
FOR EACH ROW EXECUTE FUNCTION public.touch_mapa_updated_at();

CREATE TRIGGER mapa_cp_data_updated_at
BEFORE UPDATE ON public.mapa_cp_data
FOR EACH ROW EXECUTE FUNCTION public.touch_mapa_updated_at();