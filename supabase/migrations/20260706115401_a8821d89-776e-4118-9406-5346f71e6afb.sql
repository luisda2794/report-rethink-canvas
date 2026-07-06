
CREATE OR REPLACE FUNCTION public.refresh_cd5_snapshots()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  WITH paquetes AS (
    SELECT
      lp_no,
      MIN(fecha) AS primera_fecha,
      (ARRAY_AGG(estado ORDER BY fecha DESC, updated_at DESC))[1] AS ultimo_estado,
      (ARRAY_AGG(cp    ORDER BY fecha DESC, updated_at DESC))[1] AS ultimo_cp
    FROM public.entregas
    WHERE lp_no IS NOT NULL AND lp_no <> ''
    GROUP BY lp_no
  ),
  agg AS (
    SELECT ultimo_cp AS cp, LEFT(ultimo_cp, 2) AS provincia, COUNT(*)::int AS count
    FROM paquetes
    WHERE primera_fecha IS NOT NULL
      AND primera_fecha <= (CURRENT_DATE - INTERVAL '5 days')
      AND ultimo_cp IS NOT NULL AND ultimo_cp <> ''
      AND ultimo_estado NOT IN ('Entregado','Cancelar','Return_to_seller_success')
    GROUP BY ultimo_cp, LEFT(ultimo_cp, 2)
  ),
  upsert AS (
    INSERT INTO public.cd5_snapshots (cp, provincia, count, updated_at)
    SELECT cp, provincia, count, now() FROM agg
    ON CONFLICT (cp, provincia)
    DO UPDATE SET count = EXCLUDED.count, updated_at = now()
    RETURNING cp, provincia
  )
  UPDATE public.cd5_snapshots s
  SET count = 0, updated_at = now()
  WHERE s.count <> 0
    AND NOT EXISTS (SELECT 1 FROM upsert u WHERE u.cp = s.cp AND u.provincia = s.provincia);
END;
$function$;

SELECT public.refresh_cd5_snapshots();
