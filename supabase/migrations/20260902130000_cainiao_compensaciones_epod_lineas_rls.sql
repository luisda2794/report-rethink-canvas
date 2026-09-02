-- Reconciliación de Pagos Cainiao (Punto 3): la vista de Compensaciones cruza
-- cada penalización primero contra `entregas` (ya corregido en la migración
-- anterior) y, si no aparece ahí, contra `epod_lineas` como respaldo. Mismo
-- gap que ya vimos: `epod_lineas_read` no deja pasar a jefe_contable (sin
-- filas en usuario_hubs) — sin este cambio, el respaldo le devolvería
-- siempre vacío para ese rol en vez de fallar visiblemente.
ALTER POLICY "epod_lineas_read" ON public.epod_lineas
  USING (
    public.has_all_hub_access(auth.uid())
    OR public.get_user_role(auth.uid()) = 'jefe_contable'
    OR EXISTS (SELECT 1 FROM public.usuario_hubs WHERE user_id = auth.uid() AND hub_id = epod_lineas.hub_id)
  );
