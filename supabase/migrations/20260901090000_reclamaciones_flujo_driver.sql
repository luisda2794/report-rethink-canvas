-- Módulo de Reclamaciones: flujo completo de 4 etapas
-- (Abierta -> Enviada al Driver -> Respondida por Driver -> Cerrada)
--
-- Cambios:
-- 1. drivers.telefono: falta un teléfono en la entidad driver real. Hasta
--    ahora el teléfono de la reclamación era texto libre por reclamación
--    (reclamaciones.driver_telefono); ahora el dropdown de asignación
--    autocompleta desde aquí.
-- 2. reclamaciones.driver_id: FK real a drivers, para el dropdown de
--    asignación. driver_nombre/driver_telefono se mantienen como snapshot
--    denormalizado en el momento de asignar (por si el driver se renombra
--    o se borra más adelante, el histórico de la reclamación no cambia).
-- 3. reclamaciones.nota_cierre / fecha_cierre: para guardar qué se
--    respondió a Cainiao al cerrar el caso.
-- 4. Estado simplificado a 4 valores. 'en_proceso' y 'resuelta' existían en
--    el primer diseño pero no forman parte del flujo final:
--      en_proceso -> respondida_driver (se seguía gestionando tras la
--        respuesta del driver, que es justamente ese estado ahora)
--      resuelta   -> cerrada (equivalente directo)

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS telefono text;

ALTER TABLE public.reclamaciones
  ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nota_cierre text,
  ADD COLUMN IF NOT EXISTS fecha_cierre timestamptz;

CREATE INDEX IF NOT EXISTS idx_reclamaciones_driver ON public.reclamaciones(driver_id);

-- Migrar datos existentes a los 4 estados finales antes de endurecer el
-- CHECK constraint (si no, filas con 'en_proceso'/'resuelta' romperían el
-- ALTER TABLE siguiente).
UPDATE public.reclamaciones SET estado = 'respondida_driver' WHERE estado = 'en_proceso';
UPDATE public.reclamaciones
  SET estado = 'cerrada', fecha_cierre = COALESCE(fecha_cierre, updated_at)
  WHERE estado = 'resuelta';

ALTER TABLE public.reclamaciones DROP CONSTRAINT IF EXISTS reclamaciones_estado_check;
ALTER TABLE public.reclamaciones
  ADD CONSTRAINT reclamaciones_estado_check
  CHECK (estado IN ('abierta','enviada_driver','respondida_driver','cerrada'));

COMMENT ON COLUMN public.reclamaciones.driver_id IS
  'FK a drivers.id, origen del dropdown de asignación. driver_nombre/driver_telefono quedan como snapshot en el momento de asignar.';
COMMENT ON COLUMN public.reclamaciones.nota_cierre IS
  'Nota opcional de qué se respondió a Cainiao al cerrar el caso (fuera del sistema, vía panel LDS).';
