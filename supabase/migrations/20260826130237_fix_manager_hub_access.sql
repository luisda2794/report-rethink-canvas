-- Corrige la migración 20260826113706_manager_full_hub_access.sql, que le
-- daba a "manager" el mismo alcance que "admin" (todos los hubs) — regla de
-- negocio incorrecta. La regla real: "manager" se comporta igual que un
-- jefe de flota, solo ve los hubs de usuario_hubs. Únicamente "admin" tiene
-- acceso automático a todos los hubs.
--
-- Este archivo es seguro de aplicar tanto si la migración original ya corrió
-- en la base (la corrige) como si nunca corrió (CREATE OR REPLACE es
-- idempotente y deja la función ya con el criterio correcto desde el
-- principio). No hace falta tocar las políticas de entregas/epod_uploads/
-- epod_lineas: siguen llamando a has_all_hub_access(), solo cambia su cuerpo.
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
