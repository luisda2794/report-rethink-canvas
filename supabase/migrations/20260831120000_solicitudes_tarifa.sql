-- Cadena de aprobación jerárquica para cambios de tarifa: ningún cambio de
-- tarifa (normal en driver_tarifas, o situación especial en
-- situaciones_especiales) iniciado por un jefe_flota se aplica directo —
-- pasa por solicitudes_tarifa: Jefe de Flota solicita → Manager aprueba →
-- Jefe Contable aprueba → Admin aprueba → recién ahí se escribe el cambio
-- real. manager/admin conservan edición directa (decisión explícita: solo
-- jefe_flota queda gateado).

-- 1. Nuevo rol "jefe_contable" — distinto del "contable" ya existente (que
-- queda como está, sin uso hoy). Se agrega al CHECK de profiles.role.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('admin','manager','jefe_flota','contable','jefe_contable','customer'));

-- 2. Cierra el hueco real: hoy driver_tarifas/situaciones_especiales solo
-- exigen is_admin() O pertenencia al hub (usuario_hubs) para escribir — un
-- jefe_flota con acceso al hub podría escribir directo (ej. desde la consola
-- del navegador) aunque el frontend no le muestre el botón de guardado
-- directo. Se excluye explícitamente el rol jefe_flota de las políticas de
-- escritura de ambas tablas — su único camino para cambiar una tarifa pasa
-- a ser una solicitud aprobada.
DROP POLICY IF EXISTS "tarifas_insert" ON public.driver_tarifas;
CREATE POLICY "tarifas_insert" ON public.driver_tarifas FOR INSERT TO authenticated
WITH CHECK (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = driver_tarifas.hub_id)
  )
);

DROP POLICY IF EXISTS "tarifas_update" ON public.driver_tarifas;
CREATE POLICY "tarifas_update" ON public.driver_tarifas FOR UPDATE TO authenticated
USING (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = driver_tarifas.hub_id)
  )
);

DROP POLICY IF EXISTS "tarifas_delete" ON public.driver_tarifas;
CREATE POLICY "tarifas_delete" ON public.driver_tarifas FOR DELETE TO authenticated
USING (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) <> 'jefe_flota'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = driver_tarifas.hub_id)
  )
);

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

-- 3. Tabla de solicitudes
CREATE TABLE IF NOT EXISTS public.solicitudes_tarifa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  hub_nombre text NOT NULL, -- snapshot: jefe_contable no tiene usuario_hubs,
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  driver_nombre text NOT NULL, -- así que no puede leer hubs/drivers por RLS
  tipo text NOT NULL CHECK (tipo IN ('tarifa_normal','situacion_especial')),
  codigo_postal text NOT NULL,
  fecha date, -- solo aplica si tipo = 'situacion_especial'
  valores_propuestos jsonb NOT NULL, -- { tarifa_to_door, tarifa_pudo_primero, tarifa_pudo_extra, precio_salida, nota }
  valores_anteriores jsonb, -- snapshot de lo que había antes, para el "antes/después"
  solicitado_por uuid NOT NULL REFERENCES auth.users(id),
  solicitado_por_nombre text NOT NULL, -- ídem: manager/contable no pueden
  solicitado_en timestamptz NOT NULL DEFAULT now(),
  estado text NOT NULL DEFAULT 'pendiente_manager'
    CHECK (estado IN ('pendiente_manager','pendiente_contable','pendiente_admin','aprobado','rechazado')),
  aprobado_manager_por uuid REFERENCES auth.users(id),
  aprobado_manager_nombre text, -- copia del nombre al momento de aprobar: un
  aprobado_manager_en timestamptz,
  aprobado_contable_por uuid REFERENCES auth.users(id),
  aprobado_contable_nombre text, -- jefe_flota no puede leer perfiles ajenos
  aprobado_contable_en timestamptz,
  aprobado_admin_por uuid REFERENCES auth.users(id),
  aprobado_admin_nombre text, -- (RLS de profiles), así que "quién aprobó/
  aprobado_admin_en timestamptz,
  rechazado_por uuid REFERENCES auth.users(id),
  rechazado_nombre text, -- rechazó" se guarda acá, no se joinea en vivo.
  rechazado_en timestamptz,
  rechazado_en_etapa text CHECK (rechazado_en_etapa IN ('manager','contable','admin')),
  motivo_rechazo text
);

GRANT SELECT, INSERT, UPDATE ON public.solicitudes_tarifa TO authenticated;
GRANT ALL ON public.solicitudes_tarifa TO service_role;
ALTER TABLE public.solicitudes_tarifa ENABLE ROW LEVEL SECURITY;

-- Lectura: jefe_flota ve solo lo propio; manager ve lo que está en su etapa
-- (dentro de sus hubs) o ya resuelto; jefe_contable ve lo que está en su
-- etapa (sin scope de hub — es un rol contable único, no asignado a hubs
-- puntuales) o ya resuelto; admin ve todo.
CREATE POLICY "solicitudes_tarifa_read" ON public.solicitudes_tarifa FOR SELECT TO authenticated
USING (
  is_admin(auth.uid())
  OR solicitado_por = auth.uid()
  OR (
    get_user_role(auth.uid()) = 'manager'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = solicitudes_tarifa.hub_id)
    AND (estado = 'pendiente_manager' OR estado IN ('aprobado','rechazado'))
  )
  OR (
    get_user_role(auth.uid()) = 'jefe_contable'
    AND (estado = 'pendiente_contable' OR estado IN ('aprobado','rechazado'))
  )
);

-- Creación: solo jefe_flota (o admin) para sus propios hubs, y siempre a
-- nombre de quien la crea.
CREATE POLICY "solicitudes_tarifa_insert" ON public.solicitudes_tarifa FOR INSERT TO authenticated
WITH CHECK (
  solicitado_por = auth.uid()
  AND (
    is_admin(auth.uid())
    OR (
      get_user_role(auth.uid()) = 'jefe_flota'
      AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = solicitudes_tarifa.hub_id)
    )
  )
);

-- Avance de etapa: cada aprobador solo puede tocar una solicitud que esté
-- HOY parada en su propia etapa (USING, evaluado contra la fila vieja). El
-- WITH CHECK es más laxo a propósito — de otro modo Postgres reaplicaría el
-- USING contra la fila nueva (con el estado ya cambiado) y ningún avance de
-- etapa podría guardarse nunca.
CREATE POLICY "solicitudes_tarifa_update" ON public.solicitudes_tarifa FOR UPDATE TO authenticated
USING (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) = 'manager'
    AND estado = 'pendiente_manager'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = solicitudes_tarifa.hub_id)
  )
  OR (get_user_role(auth.uid()) = 'jefe_contable' AND estado = 'pendiente_contable')
)
WITH CHECK (
  is_admin(auth.uid())
  OR (
    get_user_role(auth.uid()) = 'manager'
    AND EXISTS (SELECT 1 FROM usuario_hubs WHERE user_id = auth.uid() AND hub_id = solicitudes_tarifa.hub_id)
  )
  OR get_user_role(auth.uid()) = 'jefe_contable'
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_tarifa_estado ON public.solicitudes_tarifa(estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_tarifa_solicitado_por ON public.solicitudes_tarifa(solicitado_por);
CREATE INDEX IF NOT EXISTS idx_solicitudes_tarifa_hub ON public.solicitudes_tarifa(hub_id);

NOTIFY pgrst, 'reload schema';
