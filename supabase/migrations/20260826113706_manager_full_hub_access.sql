-- NOTA (corregido): la primera versión de esta migración le daba a
-- "manager" el mismo alcance que "admin" (acceso a todos los hubs). Eso era
-- incorrecto — la regla de negocio real es que "manager" se comporta
-- exactamente igual que un jefe de flota: solo ve los hubs que tenga
-- asignados en usuario_hubs. Únicamente "admin" tiene acceso automático a
-- todos los hubs. has_all_hub_access() quedó igual de funcional a is_admin()
-- (solo role = 'admin') — se conserva como función separada, en vez de volver
-- a usar is_admin() directamente en las políticas, para no tener que volver a
-- tocar entregas/epod_uploads/epod_lineas si esto cambia de nuevo más adelante.
--
-- No se toca is_admin() en sí: sigue usándose tal cual para las políticas de
-- administración real (gestionar hubs, roles, perfiles), exclusivas de admin.
CREATE OR REPLACE FUNCTION public.has_all_hub_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role = 'admin'
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
