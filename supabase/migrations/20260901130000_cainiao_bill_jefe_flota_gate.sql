-- Cierra el mismo hueco que ya se cerró para driver_tarifas/situaciones_especiales
-- (ver 20260831090542_*.sql): las políticas de escritura de
-- cainiao_bill_uploads/cainiao_bill_lineas solo chequeaban usuario_hubs, sin
-- excluir explícitamente a jefe_flota — un jefe_flota con usuario_hubs para
-- ese hub podría insertar/borrar filas directo vía API aunque la UI no le
-- muestre la ruta /cainiao-pagos (ni siquiera está en su ROUTE_ACCESS en
-- roles.ts). Se aplica el mismo criterio ya usado en el resto de las tablas
-- financieras/de tarifa: get_user_role(auth.uid()) <> 'jefe_flota'.

DROP POLICY IF EXISTS "cainiao_bill_uploads_insert" ON public.cainiao_bill_uploads;
CREATE POLICY "cainiao_bill_uploads_insert" ON public.cainiao_bill_uploads FOR INSERT TO authenticated
WITH CHECK (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = cainiao_bill_uploads.hub_id)
  )
);

DROP POLICY IF EXISTS "cainiao_bill_uploads_delete" ON public.cainiao_bill_uploads;
CREATE POLICY "cainiao_bill_uploads_delete" ON public.cainiao_bill_uploads FOR DELETE TO authenticated
USING (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = cainiao_bill_uploads.hub_id)
  )
);

DROP POLICY IF EXISTS "cainiao_bill_lineas_insert" ON public.cainiao_bill_lineas;
CREATE POLICY "cainiao_bill_lineas_insert" ON public.cainiao_bill_lineas FOR INSERT TO authenticated
WITH CHECK (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = cainiao_bill_lineas.hub_id)
  )
);

DROP POLICY IF EXISTS "cainiao_bill_lineas_delete" ON public.cainiao_bill_lineas;
CREATE POLICY "cainiao_bill_lineas_delete" ON public.cainiao_bill_lineas FOR DELETE TO authenticated
USING (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = cainiao_bill_lineas.hub_id)
  )
);

NOTIFY pgrst, 'reload schema';
