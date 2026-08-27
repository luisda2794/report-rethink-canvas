-- Dashboard (Fase 4, tanda 2): desglose de incidencias por tipo (widget #4)
-- y aviso de "días sin actividad reciente" (widget #7).

-- epod_uploads no tenía ningún índice sobre hub_id — lo usan tanto
-- dashboard_last_upload() de abajo como el historial de /epod (loadHistory).
CREATE INDEX IF NOT EXISTS idx_epod_uploads_hub_created ON public.epod_uploads(hub_id, created_at);

-- Cuenta de exception_detail (no vacío) en epod_lineas para el rango de
-- fechas dado, de mayor a menor. motivo no se usa: ninguna carga lo llena
-- hoy (columna muerta), la incidencia real vive en exception_detail.
CREATE OR REPLACE FUNCTION public.dashboard_incidencias_stats(_hub_ids uuid[], _from date, _to date)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('motivo', motivo, 'n', n) ORDER BY n DESC), '[]'::jsonb)
  FROM (
    SELECT exception_detail AS motivo, COUNT(*)::int AS n
    FROM public.epod_lineas
    WHERE hub_id = ANY(_hub_ids)
      AND fecha BETWEEN _from AND _to
      AND exception_detail IS NOT NULL AND exception_detail <> ''
    GROUP BY exception_detail
  ) t
$function$;

-- Última subida (epod_uploads.created_at, no fecha_epod: nos interesa cuándo
-- se subió, no la fecha que trae el archivo) por hub, para detectar hubs sin
-- actividad reciente.
CREATE OR REPLACE FUNCTION public.dashboard_last_upload(_hub_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('hub_id', hub_id, 'last_upload_at', last_upload_at)), '[]'::jsonb)
  FROM (
    SELECT hub_id, MAX(created_at) AS last_upload_at
    FROM public.epod_uploads
    WHERE hub_id = ANY(_hub_ids)
    GROUP BY hub_id
  ) t
$function$;