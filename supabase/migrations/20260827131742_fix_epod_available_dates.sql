-- Fix: el selector de "Día" (Mapa de Entregas, Flow Meeting, Paquetes en
-- Riesgo) leía epod_uploads.fecha_epod, que NO es "la fecha de esa subida"
-- sino el Task Date MÍNIMO encontrado en todo el archivo (ver epod.tsx:
-- `dates.sort(); fecha_epod = dates[0]`). Como un ePOD normalmente trae
-- muchos días de historial por waybill, eso colapsaba cada subida a un solo
-- día casi siempre viejo, dejando fuera la inmensa mayoría de fechas reales
-- presentes en epod_lineas. Esta función lee las fechas reales.
CREATE OR REPLACE FUNCTION public.epod_available_dates(_hub_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(fecha ORDER BY fecha DESC), '[]'::jsonb)
  FROM (
    SELECT DISTINCT fecha
    FROM public.epod_lineas
    WHERE hub_id = _hub_id AND fecha IS NOT NULL
  ) t
$function$;
