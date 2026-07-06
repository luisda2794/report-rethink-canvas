
ALTER TABLE public.cd13_snapshots RENAME TO cd5_snapshots;

DROP FUNCTION IF EXISTS public.refresh_cd13_snapshots();

CREATE OR REPLACE FUNCTION public.refresh_cd5_snapshots()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  WITH agg AS (
    SELECT
      e.cp AS cp,
      LEFT(e.cp, 2) AS provincia,
      COUNT(*)::int AS count
    FROM public.entregas e
    WHERE e.cp IS NOT NULL
      AND e.cp <> ''
      AND e.fecha_inbound IS NOT NULL
      AND e.fecha_inbound < (CURRENT_DATE - INTERVAL '5 days')
      AND e.estado NOT IN ('Entregado', 'Cancelar', 'Return_to_seller_success')
    GROUP BY e.cp, LEFT(e.cp, 2)
  )
  INSERT INTO public.cd5_snapshots (cp, provincia, count, updated_at)
  SELECT cp, provincia, count, now() FROM agg
  ON CONFLICT (cp, provincia)
  DO UPDATE SET count = EXCLUDED.count, updated_at = now();

  UPDATE public.cd5_snapshots s
  SET count = 0, updated_at = now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.entregas e
    WHERE e.cp = s.cp
      AND LEFT(e.cp, 2) = s.provincia
      AND e.fecha_inbound IS NOT NULL
      AND e.fecha_inbound < (CURRENT_DATE - INTERVAL '5 days')
      AND e.estado NOT IN ('Entregado', 'Cancelar', 'Return_to_seller_success')
  )
  AND s.count <> 0;
END;
$function$;
