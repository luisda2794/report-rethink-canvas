
CREATE TABLE public.cd13_snapshots (
  cp text NOT NULL,
  provincia text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cp, provincia)
);

GRANT SELECT ON public.cd13_snapshots TO anon, authenticated;
GRANT ALL ON public.cd13_snapshots TO service_role;

ALTER TABLE public.cd13_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cd13_snapshots public read"
  ON public.cd13_snapshots
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Refresca el snapshot: cuenta paquetes con fecha_inbound de hace más de 13 días
-- que aún NO están en un estado terminal (Entregado / Cancelar / Return_to_seller_success),
-- es decir, siguen "en reparto".
CREATE OR REPLACE FUNCTION public.refresh_cd13_snapshots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      AND e.fecha_inbound < (CURRENT_DATE - INTERVAL '13 days')
      AND e.estado NOT IN ('Entregado', 'Cancelar', 'Return_to_seller_success')
    GROUP BY e.cp, LEFT(e.cp, 2)
  )
  INSERT INTO public.cd13_snapshots (cp, provincia, count, updated_at)
  SELECT cp, provincia, count, now() FROM agg
  ON CONFLICT (cp, provincia)
  DO UPDATE SET count = EXCLUDED.count, updated_at = now();

  -- Pone a 0 los CP que ya no tienen paquetes CD13
  UPDATE public.cd13_snapshots s
  SET count = 0, updated_at = now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.entregas e
    WHERE e.cp = s.cp
      AND LEFT(e.cp, 2) = s.provincia
      AND e.fecha_inbound IS NOT NULL
      AND e.fecha_inbound < (CURRENT_DATE - INTERVAL '13 days')
      AND e.estado NOT IN ('Entregado', 'Cancelar', 'Return_to_seller_success')
  )
  AND s.count <> 0;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
