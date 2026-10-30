CREATE OR REPLACE FUNCTION public.riesgo_cd_stats(_hub_id uuid, _now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  WITH t AS (
    SELECT COALESCE(NULLIF(e.lp_no,''), e.waybill) AS pk, e.waybill, e.driver, e.cp, e.ciudad, e.direccion,
      e.delivery_type_raw, e.locker_pudo_id, e.pop_station_id, e.seller_name, e.market_place_name,
      e.inbound_at, e.delivered_at, e.failed_at, e.creation_at, e.row_index,
      lower(COALESCE(NULLIF(e.task_status_raw,''), e.estado)) AS st,
      COALESCE(e.delivered_at, e.failed_at, e.creation_at, e.inbound_at) AS ts,
      NULLIF(COALESCE(NULLIF(e.fail_detail,''), e.exception_detail), '') AS motivo_f
    FROM public.epod_lineas e
    WHERE e.hub_id = _hub_id AND e.export_at IS NOT NULL
  ),
  last_t AS (
    SELECT DISTINCT ON (t.pk) t.pk, t.st AS last_st, t.ts AS last_ts, t.driver, t.cp, t.ciudad, t.direccion, t.waybill,
      t.delivery_type_raw, COALESCE(NULLIF(t.locker_pudo_id,''), t.pop_station_id) AS pudo, t.seller_name, t.market_place_name
    FROM t ORDER BY t.pk, t.ts DESC NULLS LAST, t.row_index DESC
  ),
  last_m AS (
    SELECT DISTINCT ON (t.pk) t.pk, t.motivo_f AS ultimo_motivo
    FROM t WHERE t.motivo_f IS NOT NULL
    ORDER BY t.pk, COALESCE(t.failed_at, t.creation_at) DESC NULLS LAST, t.row_index DESC
  ),
  agg AS (
    SELECT t.pk,
      MIN(t.inbound_at) AS inbound,
      BOOL_OR(t.st IN ('delivered','entregado')) AS entregado,
      COUNT(*) AS n_tareas,
      COUNT(*) FILTER (WHERE t.st = 'attempt failure') AS n_fallos,
      BOOL_OR(upper(COALESCE(t.delivery_type_raw,'')) = 'DELIVERY_TO_DOOR_RETURN') AS has_return_type,
      BOOL_OR(t.st LIKE 'return_to_seller%') AS has_rts,
      BOOL_OR(t.st IN ('driver_received','driver_received_incidencias','attempt failure','delivered','entregado','cancel','cancelar','cancelled')
              AND t.ts IS NOT NULL
              AND (t.ts AT TIME ZONE 'Europe/Madrid')::date = (_now AT TIME ZONE 'Europe/Madrid')::date) AS en_reparto_hoy
    FROM t GROUP BY t.pk
  ),
  paq AS (
    SELECT a.pk, a.inbound, a.n_tareas, a.n_fallos, a.has_return_type, a.has_rts,
      l.last_st, l.last_ts, l.driver, l.cp, l.ciudad, l.direccion, l.waybill, l.delivery_type_raw, l.pudo,
      m.ultimo_motivo, norm_txt(m.ultimo_motivo) AS motivo_n,
      clasificar_origen(l.seller_name, l.market_place_name) AS origen
    FROM agg a JOIN last_t l ON l.pk = a.pk LEFT JOIN last_m m ON m.pk = a.pk
    WHERE a.en_reparto_hoy AND a.inbound IS NOT NULL
  ),
  ruled AS (
    SELECT p.*,
      CASE
        WHEN p.has_return_type THEN 'R0'
        WHEN p.n_tareas = 1 AND p.last_st IN ('cancel','cancelar','cancelled','assigned') AND _now - p.last_ts > interval '24 hours' THEN 'R1'
        WHEN EXISTS (SELECT 1 FROM public.hub_cp_excluidos x WHERE x.hub_id = _hub_id AND x.cp = p.cp) THEN 'R2'
        WHEN p.has_rts THEN 'R3'
        WHEN p.last_st IN ('cancel','cancelar','cancelled','attempt failure') AND _now - p.last_ts >= interval '7 days' THEN 'R4'
        WHEN p.motivo_n ~ 'dir+eccion incorrecta' THEN 'R5'
        WHEN p.motivo_n LIKE '%fuera de mi ruta%' THEN 'R6'
        WHEN p.motivo_n LIKE '%rechazado por el cliente%' THEN 'R7'
      END AS regla,
      p.inbound + CASE WHEN p.origen = 'China' THEN interval '216 hours' ELSE interval '120 hours' END AS limite
    FROM paq p
  ),
  bounds AS (
    SELECT (date_trunc('day', _now AT TIME ZONE 'Europe/Madrid') + interval '1 day') AT TIME ZONE 'Europe/Madrid' AS fin_hoy,
           (date_trunc('day', _now AT TIME ZONE 'Europe/Madrid') + interval '2 day') AT TIME ZONE 'Europe/Madrid' AS fin_manana
  ),
  riesgo AS (
    SELECT r.*,
      CASE WHEN r.limite <= _now THEN 'roto' WHEN r.limite < b.fin_hoy THEN 'hoy' ELSE 'manana' END AS grupo,
      CASE WHEN r.origen = 'China' OR _now > r.inbound + interval '216 hours' THEN 'CD9' ELSE 'CD5' END AS metrica,
      ROUND((EXTRACT(EPOCH FROM (r.limite - _now)) / 3600.0)::numeric, 1) AS horas
    FROM ruled r CROSS JOIN bounds b
    WHERE r.regla IS NULL
  )
  SELECT jsonb_build_object(
    'ahora', _now,
    'sin_horas', NOT EXISTS (SELECT 1 FROM public.epod_lineas x WHERE x.hub_id = _hub_id AND x.inbound_at IS NOT NULL),
    'paquetes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', q.pk, 'waybill', q.waybill, 'origen', q.origen, 'metrica', q.metrica, 'grupo', q.grupo,
        'inbound_at', q.inbound, 'limite', q.limite, 'horas', q.horas, 'ultimo_estado', q.last_st,
        'intentos', q.n_fallos, 'ultimo_motivo', q.ultimo_motivo, 'tipo', q.delivery_type_raw, 'pudo', q.pudo,
        'cp', q.cp, 'ciudad', q.ciudad, 'direccion', q.direccion, 'driver', q.driver)
      ORDER BY CASE q.grupo WHEN 'roto' THEN 0 WHEN 'hoy' THEN 1 ELSE 2 END, q.limite) FROM riesgo q), '[]'::jsonb),
    'fuera_target', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', f.pk, 'regla', f.regla, 'origen', f.origen, 'inbound_at', f.inbound, 'ultimo_estado', f.last_st,
        'ultimo_motivo', f.ultimo_motivo, 'cp', f.cp, 'driver', f.driver) ORDER BY f.regla, f.inbound)
      FROM (SELECT * FROM ruled WHERE regla IS NOT NULL ORDER BY inbound LIMIT 3000) f), '[]'::jsonb)
  )
$$;
GRANT EXECUTE ON FUNCTION public.riesgo_cd_stats(uuid, timestamptz) TO authenticated;