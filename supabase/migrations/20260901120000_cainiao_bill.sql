-- Reconciliación de Pagos Cainiao (Punto 1): guarda tal cual las filas del
-- bill quincenal de Cainiao (ZIP con 1 CSV UTF-8 con BOM adentro), para
-- después cruzarlas contra entregas/epod_lineas (Punto 2-3) y compararlas
-- contra lo que pagamos a drivers (Punto 4). Puramente de lectura/auditoría
-- de negocio — no toca driver_tarifas/situaciones_especiales/borradores.

CREATE TABLE IF NOT EXISTS public.cainiao_bill_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  filename text NOT NULL,
  periodo_desde date,
  periodo_hasta date,
  total_filas integer,
  total_importe numeric,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cainiao_bill_lineas (
  id bigserial PRIMARY KEY,
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL REFERENCES public.cainiao_bill_uploads(id) ON DELETE CASCADE,
  lp_no text, -- limpio (sin el apóstrofe inicial); null si la fila no trae un LP real (ej. 'contingencyplanluan)
  lp_no_raw text, -- valor original tal cual venía en el CSV, por si acaso
  bill_item text NOT NULL, -- valor original en chino
  bill_item_es text NOT NULL, -- traducción calculada al insertar
  bill_amount numeric NOT NULL,
  billing_time timestamptz,
  business_node_time timestamptz,
  codigo_postal text,
  aamodel_first_order text,
  aamodel_code text,
  weight_g numeric,
  charging_currency text,
  raw jsonb NOT NULL -- fila completa original, para auditar cualquier campo no mapeado
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cainiao_bill_uploads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cainiao_bill_lineas TO authenticated;
GRANT ALL ON public.cainiao_bill_uploads TO service_role;
GRANT ALL ON public.cainiao_bill_lineas TO service_role;
ALTER TABLE public.cainiao_bill_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cainiao_bill_lineas ENABLE ROW LEVEL SECURITY;

-- Lectura: admin ve todo; manager/quien tenga el hub asignado ve su hub;
-- jefe_contable ve todo sin scope de hub (mismo criterio ya usado en
-- solicitudes_tarifa — es un rol de reconciliación, no asignado a hubs
-- puntuales via usuario_hubs).
CREATE POLICY "cainiao_bill_uploads_read" ON public.cainiao_bill_uploads FOR SELECT TO authenticated
USING (
  is_admin(auth.uid())
  OR get_user_role(auth.uid()) = 'jefe_contable'
  OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = cainiao_bill_uploads.hub_id)
);

-- Escritura (subir/borrar el archivo): admin/manager con acceso al hub. No
-- jefe_contable — su rol acá es de revisión, no de carga. jefe_flota tampoco
-- (ni siquiera tiene esta ruta en el nav — ver ROUTE_ACCESS en roles.ts) —
-- se excluye explícitamente por RLS igual que ya se hizo para
-- driver_tarifas/situaciones_especiales, para que el gateo no dependa solo
-- de que la UI no le muestre el botón.
CREATE POLICY "cainiao_bill_uploads_insert" ON public.cainiao_bill_uploads FOR INSERT TO authenticated
WITH CHECK (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = cainiao_bill_uploads.hub_id)
  )
);

CREATE POLICY "cainiao_bill_uploads_delete" ON public.cainiao_bill_uploads FOR DELETE TO authenticated
USING (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = cainiao_bill_uploads.hub_id)
  )
);

CREATE POLICY "cainiao_bill_lineas_read" ON public.cainiao_bill_lineas FOR SELECT TO authenticated
USING (
  is_admin(auth.uid())
  OR get_user_role(auth.uid()) = 'jefe_contable'
  OR EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = cainiao_bill_lineas.hub_id)
);

CREATE POLICY "cainiao_bill_lineas_insert" ON public.cainiao_bill_lineas FOR INSERT TO authenticated
WITH CHECK (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = cainiao_bill_lineas.hub_id)
  )
);

CREATE POLICY "cainiao_bill_lineas_delete" ON public.cainiao_bill_lineas FOR DELETE TO authenticated
USING (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = cainiao_bill_lineas.hub_id)
  )
);

CREATE INDEX IF NOT EXISTS idx_cainiao_bill_lineas_upload ON public.cainiao_bill_lineas(upload_id);
CREATE INDEX IF NOT EXISTS idx_cainiao_bill_lineas_hub_lp ON public.cainiao_bill_lineas(hub_id, lp_no);
CREATE INDEX IF NOT EXISTS idx_cainiao_bill_lineas_bill_item ON public.cainiao_bill_lineas(bill_item);
CREATE INDEX IF NOT EXISTS idx_cainiao_bill_uploads_hub ON public.cainiao_bill_uploads(hub_id, uploaded_at DESC);

NOTIFY pgrst, 'reload schema';
