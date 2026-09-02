-- Reconciliación de Pagos Cainiao (Punto 2): el matching necesita leer
-- `entregas` para saber qué paquetes entregamos. Hoy `entregas_read` solo
-- deja pasar a admin (has_all_hub_access) o a quien tenga el hub asignado
-- en usuario_hubs — jefe_contable no tiene filas en usuario_hubs (mismo
-- criterio ya usado en solicitudes_tarifa/cainiao_bill_uploads: es un rol
-- de reconciliación, no asignado a hubs puntuales), así que sin este
-- cambio no podría ver `entregas` en absoluto y el matching le fallaría.
ALTER POLICY "entregas_read" ON public.entregas
  USING (
    public.has_all_hub_access(auth.uid())
    OR public.get_user_role(auth.uid()) = 'jefe_contable'
    OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = entregas.hub_id)
  );
