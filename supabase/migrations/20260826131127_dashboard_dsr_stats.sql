-- Dashboard (Fase 4, tanda 1): DSR real necesita la fecha REAL del evento
-- (Tiempo de Entrega / Tiempo del Fracaso de la Entrega), no la Fecha de la
-- Tarea — epod_lineas no las guardaba todavía (solo se leían desde un Excel
-- ad-hoc en DashboardDsrWidgets). Se agregan como columnas nuevas, mismo
-- patrón que market_place_name/seller_name/latitude/longitude de Fase 1.
ALTER TABLE public.epod_lineas
  ADD COLUMN IF NOT EXISTS tiempo_entrega date,
  ADD COLUMN IF NOT EXISTS tiempo_fracaso date;

-- La consulta de dashboard_dsr_stats() filtra por hub_id + estado (no por
-- fecha, ya que la fecha real del evento puede venir de tiempo_entrega o
-- tiempo_fracaso según el caso) — este índice compuesto la soporta.
CREATE INDEX IF NOT EXISTS idx_epod_lineas_hub_estado ON public.epod_lineas(hub_id, estado);

-- Devuelve, para el conjunto de hubs dado, la tendencia diaria de
-- entregados/fallos de los últimos `_window_days` días terminando en `_to`
-- (excluyendo sábado/domingo salvo que _include_weekends sea true) más el
-- desglose por CP y por driver sobre ese mismo conjunto de días — todo
-- agregado en SQL para no traer filas crudas al cliente.
CREATE OR REPLACE FUNCTION public.dashboard_dsr_stats(
  _hub_ids uuid[],
  _to date DEFAULT CURRENT_DATE,
  _include_weekends boolean DEFAULT false,
  _window_days int DEFAULT 14
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH candidate_days AS (
    -- 28 días calendario de margen hacia atrás: siempre alcanzan para cubrir
    -- _window_days días hábiles (mínimo 20 hábiles en 4 semanas).
    SELECT d::date AS dia
    FROM generate_series(_to - 27, _to, interval '1 day') AS d
    WHERE _include_weekends OR EXTRACT(ISODOW FROM d) < 6
  ),
  window_days AS (
    SELECT dia FROM candidate_days ORDER BY dia DESC LIMIT _window_days
  ),
  src AS (
    SELECT
      cp,
      driver,
      estado,
      CASE WHEN estado = 'Entregado' THEN COALESCE(tiempo_entrega, fecha) END AS delivered_date,
      CASE WHEN estado = 'Attempt Failure' THEN COALESCE(tiempo_fracaso, fecha) END AS failed_date
    FROM public.epod_lineas
    WHERE hub_id = ANY(_hub_ids)
      AND estado IN ('Entregado', 'Attempt Failure')
  ),
  filtered AS (
    SELECT s.*, w.dia AS event_date
    FROM src s
    JOIN window_days w ON w.dia = COALESCE(s.delivered_date, s.failed_date)
  ),
  by_day AS (
    SELECT w.dia AS fecha,
      COUNT(f.*) FILTER (WHERE f.delivered_date IS NOT NULL)::int AS delivered,
      COUNT(f.*) FILTER (WHERE f.failed_date IS NOT NULL)::int AS failed
    FROM window_days w
    LEFT JOIN filtered f ON f.event_date = w.dia
    GROUP BY w.dia
  ),
  by_cp AS (
    SELECT COALESCE(NULLIF(cp, ''), '—') AS cp,
      COUNT(*) FILTER (WHERE delivered_date IS NOT NULL)::int AS delivered,
      COUNT(*) FILTER (WHERE failed_date IS NOT NULL)::int AS failed
    FROM filtered
    GROUP BY 1
  ),
  by_driver AS (
    SELECT COALESCE(NULLIF(driver, ''), '— Sin asignar —') AS driver,
      COUNT(*) FILTER (WHERE delivered_date IS NOT NULL)::int AS delivered,
      COUNT(*) FILTER (WHERE failed_date IS NOT NULL)::int AS failed
    FROM filtered
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'trend', COALESCE((SELECT jsonb_agg(jsonb_build_object('fecha', fecha, 'delivered', delivered, 'failed', failed) ORDER BY fecha) FROM by_day), '[]'::jsonb),
    'by_cp', COALESCE((SELECT jsonb_agg(jsonb_build_object('cp', cp, 'delivered', delivered, 'failed', failed)) FROM by_cp), '[]'::jsonb),
    'by_driver', COALESCE((SELECT jsonb_agg(jsonb_build_object('driver', driver, 'delivered', delivered, 'failed', failed)) FROM by_driver), '[]'::jsonb)
  )
$function$;
