
REVOKE ALL ON FUNCTION public.refresh_cd13_snapshots() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_cd13_snapshots() TO service_role, postgres;
