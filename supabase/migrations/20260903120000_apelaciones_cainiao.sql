-- Apelaciones a Cainiao: marca en Reclamaciones si un caso ya respondido por
-- el driver aplica para apelar la penalización correspondiente, y con qué
-- motivo exacto (los 12 valores vienen tal cual de la hoja "Motivo" del
-- Excel que exige Cainiao — CHECK a nivel de base como respaldo de lo que
-- ya valida la UI con un <select> de opciones fijas, no texto libre).
ALTER TABLE public.reclamaciones
  ADD COLUMN IF NOT EXISTS aplica_apelacion boolean,
  ADD COLUMN IF NOT EXISTS motivo_apelacion text;

ALTER TABLE public.reclamaciones
  DROP CONSTRAINT IF EXISTS reclamaciones_motivo_apelacion_check;
ALTER TABLE public.reclamaciones
  ADD CONSTRAINT reclamaciones_motivo_apelacion_check
    CHECK (
      motivo_apelacion IS NULL OR motivo_apelacion IN (
        'El cliente reclama faltan artículos/productos incorrectos',
        'El cliente no hay reclamacion',
        'Casos de robo/penalización/pérdida/paquete dañado',
        'Cliente ha recibido',
        'Cliente reclama por equivocacion',
        'El paquete se entrega en PUDO/ Punto de recogida/city box/mail box/tercero（vecinos/conserjes/compañeros/familiares, etc.）',
        'El paquete no se ha recogido',
        'Este no es nuestro paquete de entrega/Este no es nuestro conductor',
        'Fuera de la zona de entrega/Paquete en almacén',
        'La penalización duplicado',
        'El cliente se llama por entrega urgente/cambio de dirección/error de dirección que provoca un error de entrega/el cliente no está en casa, etc.',
        'No ha recibido ninguna reclamación'
      )
    );

-- Reconciliación de Pagos Cainiao (Apelaciones): la vista de Apelaciones
-- cruza penalizaciones contra reclamaciones apelables — mismo gap que ya
-- vimos en entregas_read/epod_lineas_read: jefe_contable no tiene filas en
-- usuario_hubs, así que sin esto no podría leer reclamaciones en absoluto.
ALTER POLICY "reclamaciones_read" ON public.reclamaciones
  USING (
    public.is_admin(auth.uid())
    OR public.get_user_role(auth.uid()) = 'jefe_contable'
    OR EXISTS (SELECT 1 FROM public.usuario_hubs WHERE user_id = auth.uid() AND hub_id = reclamaciones.hub_id)
  );

NOTIFY pgrst, 'reload schema';
