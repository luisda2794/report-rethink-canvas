-- Fase 4 (Paso 0, prerequisito): "manager" debía tener el mismo alcance que
-- "admin" sobre los datos de todos los hubs (entregas/epod_lineas/
-- epod_uploads), pero is_admin() solo reconocía role = 'admin' — tanto en el
-- selector de hub (AuthContext) como en RLS. Un manager quedaba con el mismo
-- alcance que un jefe de flota (solo sus hubs de usuario_hubs).
--
-- No se toca is_admin() en sí: sigue usándose tal cual para las políticas de
-- administración real (gestionar hubs, roles, perfiles), que deben seguir
-- siendo exclusivas de admin. Esta nueva función solo cubre visibilidad de
-- datos (entregas/epod_lineas/epod_uploads) para admin Y manager.
CREATE OR REPLACE FUNCTION public.has_all_hub_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role IN ('admin', 'manager')
  )
$$;

-- entregas
ALTER POLICY "entregas_read" ON public.entregas
  USING (public.has_all_hub_access(auth.uid()) OR EXISTS (
    SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = entregas.hub_id
  ));
ALTER POLICY "entregas_insert" ON public.entregas
  WITH CHECK (public.has_all_hub_access(auth.uid()) OR EXISTS (
    SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = entregas.hub_id
  ));
ALTER POLICY "entregas_update" ON public.entregas
  USING (public.has_all_hub_access(auth.uid()) OR EXISTS (
    SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = entregas.hub_id
  ));
ALTER POLICY "entregas_delete" ON public.entregas
  USING (public.has_all_hub_access(auth.uid()) OR EXISTS (
    SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = entregas.hub_id
  ));

-- epod_uploads
ALTER POLICY "epod_uploads_read" ON public.epod_uploads
  USING (public.has_all_hub_access(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.usuario_hubs WHERE user_id = auth.uid() AND hub_id = epod_uploads.hub_id
  ));
ALTER POLICY "epod_uploads_insert" ON public.epod_uploads
  WITH CHECK (public.has_all_hub_access(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.usuario_hubs WHERE user_id = auth.uid() AND hub_id = epod_uploads.hub_id
  ));
ALTER POLICY "epod_uploads_update" ON public.epod_uploads
  USING (public.has_all_hub_access(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.usuario_hubs WHERE user_id = auth.uid() AND hub_id = epod_uploads.hub_id
  ));
ALTER POLICY "epod_uploads_delete" ON public.epod_uploads
  USING (public.has_all_hub_access(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.usuario_hubs WHERE user_id = auth.uid() AND hub_id = epod_uploads.hub_id
  ));

-- epod_lineas
ALTER POLICY "epod_lineas_read" ON public.epod_lineas
  USING (public.has_all_hub_access(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.usuario_hubs WHERE user_id = auth.uid() AND hub_id = epod_lineas.hub_id
  ));
ALTER POLICY "epod_lineas_insert" ON public.epod_lineas
  WITH CHECK (public.has_all_hub_access(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.usuario_hubs WHERE user_id = auth.uid() AND hub_id = epod_lineas.hub_id
  ));
ALTER POLICY "epod_lineas_delete" ON public.epod_lineas
  USING (public.has_all_hub_access(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.usuario_hubs WHERE user_id = auth.uid() AND hub_id = epod_lineas.hub_id
  ));
