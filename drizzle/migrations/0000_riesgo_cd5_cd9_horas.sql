ALTER TABLE public.epod_lineas
  ADD COLUMN IF NOT EXISTS inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS creation_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS export_at timestamptz,
  ADD COLUMN IF NOT EXISTS task_status_raw text,
  ADD COLUMN IF NOT EXISTS delivery_type_raw text,
  ADD COLUMN IF NOT EXISTS fail_detail text,
  ADD COLUMN IF NOT EXISTS locker_pudo_id text,
  ADD COLUMN IF NOT EXISTS task_code text;

CREATE UNIQUE INDEX IF NOT EXISTS epod_lineas_hub_task_code_uniq ON public.epod_lineas (hub_id, task_code) WHERE task_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS epod_lineas_hub_lp_idx ON public.epod_lineas (hub_id, lp_no);

CREATE POLICY epod_lineas_update ON public.epod_lineas FOR UPDATE TO authenticated
USING (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE usuario_hubs.user_id = auth.uid() AND usuario_hubs.hub_id = epod_lineas.hub_id))
WITH CHECK (is_admin(auth.uid()) OR EXISTS (SELECT 1 FROM usuario_hubs WHERE usuario_hubs.user_id = auth.uid() AND usuario_hubs.hub_id = epod_lineas.hub_id));
GRANT UPDATE ON public.epod_lineas TO authenticated;

CREATE TABLE public.seller_origen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_name text NOT NULL,
  market_place_name text NOT NULL DEFAULT '',
  origen text NOT NULL CHECK (origen IN ('China','Local')),
  motivo text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_name, market_place_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_origen TO authenticated;
GRANT ALL ON public.seller_origen TO service_role;
ALTER TABLE public.seller_origen ENABLE ROW LEVEL SECURITY;
CREATE POLICY seller_origen_read ON public.seller_origen FOR SELECT TO authenticated USING (true);
CREATE POLICY seller_origen_write ON public.seller_origen FOR ALL TO authenticated
USING (get_user_role(auth.uid()) IN ('admin','manager'))
WITH CHECK (get_user_role(auth.uid()) IN ('admin','manager'));

CREATE TABLE public.hub_cp_excluidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.hubs(id) ON DELETE CASCADE,
  cp text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, cp)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_cp_excluidos TO authenticated;
GRANT ALL ON public.hub_cp_excluidos TO service_role;
ALTER TABLE public.hub_cp_excluidos ENABLE ROW LEVEL SECURITY;
CREATE POLICY hub_cp_excluidos_read ON public.hub_cp_excluidos FOR SELECT TO authenticated USING (true);
CREATE POLICY hub_cp_excluidos_write ON public.hub_cp_excluidos FOR ALL TO authenticated
USING (get_user_role(auth.uid()) IN ('admin','manager'))
WITH CHECK (get_user_role(auth.uid()) IN ('admin','manager'));

CREATE OR REPLACE FUNCTION public.norm_txt(_s text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT btrim(regexp_replace(lower(translate(replace(COALESCE(_s,''), chr(160), ' '),
    'ÁÀÄÂáàäâÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔóòöôÚÙÜÛúùüûÑñ',
    'aaaaaaaaeeeeeeeeiiiiiiiioooooooouuuuuuuunn')), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.clasificar_origen(_seller text, _market text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT COALESCE(
    (SELECT so.origen FROM public.seller_origen so
      WHERE so.seller_name = COALESCE(_seller,'') AND so.market_place_name = COALESCE(_market,'') LIMIT 1),
    (SELECT so.origen FROM public.seller_origen so
      WHERE so.seller_name = COALESCE(_seller,'') ORDER BY (so.market_place_name = '') DESC LIMIT 1),
    CASE
      WHEN norm_txt(_market) IN ('yun express','postlink','shunyou','yanwen','yuanyou xyc','sf','457owh') THEN 'China'
      WHEN norm_txt(_seller) ~ '(temu|shein|aliexpress|infinite remit)' OR norm_txt(_seller) = 'cbt_delivery' THEN 'China'
      WHEN COALESCE(_seller,'') ~ '[一-鿿]' OR norm_txt(_seller) ~ '(warehouse|foshan|shenzhen)' THEN 'China'
      ELSE 'Local'
    END)
$$;

CREATE OR REPLACE FUNCTION public.upsert_epod_lineas(_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE n integer;
BEGIN
  WITH src AS (
    SELECT * FROM jsonb_to_recordset(_rows) AS x(
      hub_id uuid, epod_upload_id uuid, row_index int, lp_no text, waybill text, fecha date, fecha_inbound date,
      estado text, tipo text, tipo_norm text, driver text, cp text, direccion text, contacto text, pop_station_id text,
      source text, market_place_name text, seller_name text, latitude float8, longitude float8,
      entrega_real_latitude numeric, entrega_real_longitude numeric, exception_detail text, tiempo_entrega date,
      tiempo_fracaso date, ciudad text, inbound_at text, creation_at text, delivered_at text, failed_at text,
      export_at text, task_status_raw text, delivery_type_raw text, fail_detail text, locker_pudo_id text, task_code text)
  ), conv AS (
    SELECT s.*,
      (NULLIF(s.inbound_at,'')::timestamp AT TIME ZONE 'Europe/Madrid') AS inbound_ts,
      (NULLIF(s.creation_at,'')::timestamp AT TIME ZONE 'Europe/Madrid') AS creation_ts,
      (NULLIF(s.delivered_at,'')::timestamp AT TIME ZONE 'Europe/Madrid') AS delivered_ts,
      (NULLIF(s.failed_at,'')::timestamp AT TIME ZONE 'Europe/Madrid') AS failed_ts,
      (NULLIF(s.export_at,'')::timestamp AT TIME ZONE 'Europe/Madrid') AS export_ts
    FROM src s
  ), ins AS (
    INSERT INTO public.epod_lineas AS e (hub_id, epod_upload_id, row_index, lp_no, waybill, fecha, fecha_inbound, estado, tipo,
      tipo_norm, driver, cp, direccion, contacto, pop_station_id, source, market_place_name, seller_name, latitude, longitude,
      entrega_real_latitude, entrega_real_longitude, exception_detail, tiempo_entrega, tiempo_fracaso, ciudad,
      inbound_at, creation_at, delivered_at, failed_at, export_at, task_status_raw, delivery_type_raw, fail_detail,
      locker_pudo_id, task_code)
    SELECT hub_id, epod_upload_id, row_index, lp_no, waybill, fecha, fecha_inbound, estado, tipo, tipo_norm, driver, cp,
      direccion, contacto, pop_station_id, source, market_place_name, seller_name, latitude, longitude,
      entrega_real_latitude, entrega_real_longitude, exception_detail, tiempo_entrega, tiempo_fracaso, ciudad,
      inbound_ts, creation_ts, delivered_ts, failed_ts, export_ts, task_status_raw, delivery_type_raw, fail_detail,
      locker_pudo_id, NULLIF(task_code,'')
    FROM conv
    ON CONFLICT (hub_id, task_code) WHERE task_code IS NOT NULL DO UPDATE SET
      epod_upload_id = EXCLUDED.epod_upload_id, row_index = EXCLUDED.row_index, lp_no = EXCLUDED.lp_no,
      waybill = EXCLUDED.waybill, fecha = EXCLUDED.fecha, fecha_inbound = EXCLUDED.fecha_inbound, estado = EXCLUDED.estado,
      tipo = EXCLUDED.tipo, tipo_norm = EXCLUDED.tipo_norm, driver = EXCLUDED.driver, cp = EXCLUDED.cp,
      direccion = EXCLUDED.direccion, contacto = EXCLUDED.contacto, pop_station_id = EXCLUDED.pop_station_id,
      market_place_name = EXCLUDED.market_place_name, seller_name = EXCLUDED.seller_name, latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude, entrega_real_latitude = EXCLUDED.entrega_real_latitude,
      entrega_real_longitude = EXCLUDED.entrega_real_longitude, exception_detail = EXCLUDED.exception_detail,
      tiempo_entrega = EXCLUDED.tiempo_entrega, tiempo_fracaso = EXCLUDED.tiempo_fracaso, ciudad = EXCLUDED.ciudad,
      inbound_at = EXCLUDED.inbound_at, creation_at = EXCLUDED.creation_at, delivered_at = EXCLUDED.delivered_at,
      failed_at = EXCLUDED.failed_at, export_at = EXCLUDED.export_at, task_status_raw = EXCLUDED.task_status_raw,
      delivery_type_raw = EXCLUDED.delivery_type_raw, fail_detail = EXCLUDED.fail_detail, locker_pudo_id = EXCLUDED.locker_pudo_id
    WHERE e.export_at IS NULL OR EXCLUDED.export_at >= e.export_at
    RETURNING 1
  )
  SELECT COUNT(*) INTO n FROM ins;
  RETURN n;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_epod_lineas(jsonb) TO authenticated;

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
      BOOL_OR(t.st LIKE 'return_to_seller%') AS has_rts
    FROM t GROUP BY t.pk
  ),
  paq AS (
    SELECT a.pk, a.inbound, a.n_tareas, a.n_fallos, a.has_return_type, a.has_rts,
      l.last_st, l.last_ts, l.driver, l.cp, l.ciudad, l.direccion, l.waybill, l.delivery_type_raw, l.pudo,
      m.ultimo_motivo, norm_txt(m.ultimo_motivo) AS motivo_n,
      clasificar_origen(l.seller_name, l.market_place_name) AS origen
    FROM agg a JOIN last_t l ON l.pk = a.pk LEFT JOIN last_m m ON m.pk = a.pk
    WHERE NOT a.entregado AND a.inbound IS NOT NULL
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
    WHERE r.regla IS NULL AND r.limite < b.fin_manana
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