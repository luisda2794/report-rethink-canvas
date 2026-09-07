-- agente_ejecuciones_read dejaba leer a CUALQUIER manager TODAS las filas
-- (is_admin() OR role = 'manager', sin filtrar por hub) — el mismo gap que
-- ya se cerró varias veces en este proyecto para driver_tarifas,
-- situaciones_especiales y cainiao_bill_uploads/lineas, pero acá solo se
-- corrigió en la capa de aplicación (assertAccesoAgente en
-- agentes.functions.ts), no en la policy de la tabla: un manager podía leer
-- hallazgos de hubs ajenos (KPIs, drivers en riesgo, reclamaciones
-- clasificadas, leads) consultando agente_ejecuciones directo por API,
-- salteándose el server function. Se aplica el mismo criterio de scope por
-- usuario_hubs que ya usa el resto de la app. Las filas con hub_id NULL
-- ("corrida multi-hub") quedan solo para admin, igual que ya hace
-- assertAccesoAgente (un manager siempre tiene que pasar un hub_id).

DROP POLICY IF EXISTS "agente_ejecuciones_read" ON public.agente_ejecuciones;
CREATE POLICY "agente_ejecuciones_read" ON public.agente_ejecuciones FOR SELECT TO authenticated
USING (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) = 'manager'
    AND hub_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = agente_ejecuciones.hub_id)
  )
);

NOTIFY pgrst, 'reload schema';
