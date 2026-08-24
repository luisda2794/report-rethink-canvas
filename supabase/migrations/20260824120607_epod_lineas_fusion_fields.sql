-- Fusión Menssajero + RUTAFACIL + Expansión Inteligente (Fase 1):
-- epod_lineas es la tabla fila-por-fila (una fila por cada línea del ePOD
-- subido, sin deduplicar) que ya alimenta el registro de uploads en /epod.
-- Le agregamos los campos que todavía no capturaba pero que van a necesitar
-- Reportes (mercado/vendedor para clasificar SHEIN/TEMU/Aliexpress, e
-- incidencias) y la futura sección de Rutas (lat/long), para que ambas
-- puedan alimentarse del mismo ePOD subido una sola vez en /epod, sin crear
-- una tabla ni un flujo de carga paralelo.
ALTER TABLE public.epod_lineas
  ADD COLUMN IF NOT EXISTS market_place_name text,
  ADD COLUMN IF NOT EXISTS seller_name text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS exception_detail text;
