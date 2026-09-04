-- Módulo PUDOs: gap de distancia entre la ubicación registrada del punto
-- PUDO (epod_lineas.latitude/longitude, ya existentes — "Receptor a
-- latitud/longitud") y la ubicación GPS real donde el driver marcó la
-- entrega (nueva). El parser de /epod ya se actualizó para capturarlas
-- desde "Entrega real latitud/longitud" — sin esta columna quedarían
-- descartadas en silencio.
ALTER TABLE public.epod_lineas
  ADD COLUMN IF NOT EXISTS entrega_real_latitude numeric,
  ADD COLUMN IF NOT EXISTS entrega_real_longitude numeric;

NOTIFY pgrst, 'reload schema';
