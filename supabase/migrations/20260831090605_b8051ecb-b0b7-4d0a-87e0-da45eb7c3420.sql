DROP POLICY IF EXISTS "situaciones_especiales_insert" ON public.situaciones_especiales;
CREATE POLICY "situaciones_especiales_insert" ON public.situaciones_especiales FOR INSERT TO authenticated
WITH CHECK (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = situaciones_especiales.hub_id)
  )
);

DROP POLICY IF EXISTS "situaciones_especiales_update" ON public.situaciones_especiales;
CREATE POLICY "situaciones_especiales_update" ON public.situaciones_especiales FOR UPDATE TO authenticated
USING (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = situaciones_especiales.hub_id)
  )
);

DROP POLICY IF EXISTS "situaciones_especiales_delete" ON public.situaciones_especiales;
CREATE POLICY "situaciones_especiales_delete" ON public.situaciones_especiales FOR DELETE TO authenticated
USING (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = situaciones_especiales.hub_id)
  )
);

NOTIFY pgrst, 'reload schema';