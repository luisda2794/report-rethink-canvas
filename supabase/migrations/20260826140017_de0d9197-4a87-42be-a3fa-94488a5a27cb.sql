-- Fase 4: migra "Paquetes en Riesgo" (CD5) a poder calcularse desde la base.
-- El reporte necesita "La ciudad de destino", que epod_lineas no guardaba
-- todavía — se agrega, mismo patrón que las columnas de Fase 1.
ALTER TABLE public.epod_lineas
  ADD COLUMN IF NOT EXISTS ciudad text;

-- Misma regla que ya usa la versión Excel de /reportes/paquetes-en-riesgo
-- (sin cambios de negocio, solo de origen de datos): T0 = fecha más antigua
-- vista para el waybill en TODO el histórico del hub; en riesgo = sigue en
-- Driver_received/Driver_received_incidencias en `_fecha` Y (días desde T0)
-- >= _umbral_dias. No excluye Dirección Incorrecta (la versión Excel
-- tampoco lo hace hoy).
CREATE OR REPLACE FUNCTION public.paquetes_en_riesgo_stats(_hub_id uuid, _fecha date, _umbral_dias int DEFAULT 5)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH t0 AS (
    SELECT waybill, MIN(fecha) AS inbound
    FROM public.epod_lineas
    WHERE hub_id = _hub_id AND waybill IS NOT NULL AND fecha IS NOT NULL
    GROUP BY waybill
  ),
  today_last AS (
    -- Última fila de hoy por waybill (por row_index, ya que fecha es solo
    -- día — igual criterio de desempate que ya usa la versión Excel).
    SELECT DISTINCT ON (waybill)
      waybill, estado, cp, ciudad, direccion, driver
    FROM public.epod_lineas
    WHERE hub_id = _hub_id AND fecha = _fecha AND waybill IS NOT NULL
    ORDER BY waybill, row_index DESC
  ),
  incidencias AS (
    SELECT waybill,
      COUNT(*)::int AS n,
      (ARRAY_AGG(exception_detail ORDER BY row_index DESC))[1] AS ultima
    FROM public.epod_lineas
    WHERE hub_id = _hub_id AND waybill IS NOT NULL
      AND exception_detail IS NOT NULL AND exception_detail <> ''
    GROUP BY waybill
  ),
  risk AS (
    SELECT
      tl.waybill,
      (_fecha - t0.inbound) AS dias,
      tl.cp,
      tl.ciudad,
      tl.direccion,
      tl.driver,
      COALESCE(inc.n, 0) AS num_incidencias,
      COALESCE(inc.ultima, 'Sin incidencias') AS ultima_incidencia
    FROM today_last tl
    JOIN t0 ON t0.waybill = tl.waybill
    LEFT JOIN incidencias inc ON inc.waybill = tl.waybill
    WHERE tl.estado IN ('Driver_received', 'Driver_received_incidencias')
      AND (_fecha - t0.inbound) >= _umbral_dias
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'waybill', waybill,
        'dias', dias,
        'num_incidencias', num_incidencias,
        'ultima_incidencia', ultima_incidencia,
        'cp', cp,
        'ciudad', ciudad,
        'direccion', direccion,
        'driver', driver
      )
      ORDER BY dias DESC
    ),
    '[]'::jsonb
  )
  FROM risk
$function$;