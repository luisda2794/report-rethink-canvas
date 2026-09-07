-- Reclutamiento de Repartidores: captura de leads (Instagram/TikTok Ads —
-- Vía A, pendiente de acceso real a ambas plataformas — y Milanuncios/form
-- público — Vía B, esta migración ya la soporta) con auto-asignación al
-- Jefe de Flota correspondiente según CP, reutilizando el mapeo CP→hub que
-- ya existe (mapa_cp_data + mapa_versions, el mismo de "Mapa de Provincia").

CREATE TABLE IF NOT EXISTS public.leads_reclutamiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  telefono text NOT NULL,
  codigo_postal text,
  hub_id uuid REFERENCES public.hubs(id) ON DELETE SET NULL, -- auto-asignado según CP
  fuente text NOT NULL CHECK (fuente IN ('instagram','tiktok','milanuncios','referido','otro')),
  estado text NOT NULL DEFAULT 'nuevo'
    CHECK (estado IN ('nuevo','contactado','entrevistado','contratado','descartado')),
  notas text,
  proxima_llamada date,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  -- Cuándo cambió `estado` por última vez — separado de actualizado_en (que
  -- se toca con cualquier edición, incluida una nota) para poder detectar
  -- "sin seguimiento hace 48-72h" de verdad, no solo "nadie tocó el registro".
  estado_actualizado_en timestamptz NOT NULL DEFAULT now(),
  raw jsonb -- payload crudo del formulario/webhook original, para auditar
);

GRANT SELECT, INSERT, UPDATE ON public.leads_reclutamiento TO authenticated;
GRANT ALL ON public.leads_reclutamiento TO service_role;
ALTER TABLE public.leads_reclutamiento ENABLE ROW LEVEL SECURITY;

-- Lectura: admin y manager ven TODOS los leads (decisión explícita del
-- usuario para este módulo — distinto del resto de la app, donde manager
-- suele estar limitado a sus hubs vía usuario_hubs). jefe_flota ve solo los
-- de su(s) hub(s) asignado(s).
CREATE POLICY "leads_reclutamiento_read" ON public.leads_reclutamiento FOR SELECT TO authenticated
USING (
  is_admin(auth.uid())
  OR get_user_role(auth.uid()) = 'manager'
  OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = leads_reclutamiento.hub_id)
);

-- Creación manual desde la app (ej. un lead "referido"): solo admin/manager.
-- Los leads de webhooks (Vía A, pendiente) y del formulario público (Vía B)
-- se insertan server-side con la service role, sin pasar por esta policy.
CREATE POLICY "leads_reclutamiento_insert" ON public.leads_reclutamiento FOR INSERT TO authenticated
WITH CHECK (is_admin(auth.uid()) OR get_user_role(auth.uid()) = 'manager');

-- Edición (cambiar estado, notas, próxima llamada, o reasignar hub_id un
-- lead "Sin asignar"): admin/manager sobre cualquier lead, jefe_flota solo
-- sobre los de su hub.
CREATE POLICY "leads_reclutamiento_update" ON public.leads_reclutamiento FOR UPDATE TO authenticated
USING (
  is_admin(auth.uid())
  OR get_user_role(auth.uid()) = 'manager'
  OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = leads_reclutamiento.hub_id)
);

-- Auto-asignación por CP: si el lead llega sin hub_id pero con CP, busca en
-- la versión activa de mapa_cp_data. Si el CP no mapea a ningún hub, queda
-- NULL a propósito — la UI lo muestra como "Sin asignar" para revisión
-- manual, no se inventa un hub ni se descarta el lead.
CREATE OR REPLACE FUNCTION public.asignar_hub_por_cp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hub_id IS NULL AND NEW.codigo_postal IS NOT NULL THEN
    SELECT mcd.hub_id INTO NEW.hub_id
    FROM public.mapa_cp_data mcd
    JOIN public.mapa_versions mv ON mv.id = mcd.version_id AND mv.activa = true
    WHERE mcd.cp = NEW.codigo_postal
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asignar_hub_por_cp ON public.leads_reclutamiento;
CREATE TRIGGER trg_asignar_hub_por_cp
BEFORE INSERT ON public.leads_reclutamiento
FOR EACH ROW EXECUTE FUNCTION public.asignar_hub_por_cp();

-- Mantiene actualizado_en (cualquier cambio) y estado_actualizado_en (solo
-- cuando cambia estado) al día en cada UPDATE.
CREATE OR REPLACE FUNCTION public.touch_leads_reclutamiento()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en = now();
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    NEW.estado_actualizado_en = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_leads_reclutamiento ON public.leads_reclutamiento;
CREATE TRIGGER trg_touch_leads_reclutamiento
BEFORE UPDATE ON public.leads_reclutamiento
FOR EACH ROW EXECUTE FUNCTION public.touch_leads_reclutamiento();

CREATE INDEX IF NOT EXISTS idx_leads_reclutamiento_hub ON public.leads_reclutamiento(hub_id);
CREATE INDEX IF NOT EXISTS idx_leads_reclutamiento_estado ON public.leads_reclutamiento(estado);
CREATE INDEX IF NOT EXISTS idx_leads_reclutamiento_fuente ON public.leads_reclutamiento(fuente);

NOTIFY pgrst, 'reload schema';
