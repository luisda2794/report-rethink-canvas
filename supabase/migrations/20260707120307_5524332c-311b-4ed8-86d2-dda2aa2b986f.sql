CREATE OR REPLACE FUNCTION public.dashboard_stats(_hub_ids uuid[], _from date, _to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH src AS (
    SELECT fecha, estado, tipo_norm, tipo, es_aa
    FROM public.entregas
    WHERE hub_id = ANY(_hub_ids)
      AND fecha BETWEEN _from AND _to
  ),
  totals AS (
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE es_aa)::int AS aa
    FROM src
  ),
  hoy AS (
    SELECT COUNT(*)::int AS en_reparto_hoy
    FROM public.entregas
    WHERE hub_id = ANY(_hub_ids)
      AND fecha = CURRENT_DATE
      AND estado IN ('Driver_received','Assigned')
  ),
  by_day AS (
    SELECT
      fecha,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE estado = 'Entregado')::int AS entregados,
      COUNT(*) FILTER (WHERE estado = 'Attempt Failure')::int AS incidencias,
      COUNT(*) FILTER (WHERE estado IN ('Driver_received','Assigned'))::int AS en_reparto
    FROM src
    WHERE fecha IS NOT NULL
    GROUP BY fecha
  ),
  by_tipo AS (
    SELECT UPPER(COALESCE(tipo_norm, tipo, 'OTRO')) AS tipo, COUNT(*)::int AS n
    FROM src
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'total', (SELECT total FROM totals),
    'aa', (SELECT aa FROM totals),
    'en_reparto_hoy', (SELECT en_reparto_hoy FROM hoy),
    'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object('fecha', fecha, 'total', total, 'entregados', entregados, 'incidencias', incidencias, 'en_reparto', en_reparto) ORDER BY fecha) FROM by_day), '[]'::jsonb),
    'by_tipo', COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'n', n) ORDER BY n DESC) FROM by_tipo), '[]'::jsonb)
  )
$function$;