
-- 1. Drop old policies that depend on has_role / user_roles
DROP POLICY IF EXISTS "Admins manage hubs delete" ON public.hubs;
DROP POLICY IF EXISTS "Admins manage hubs update" ON public.hubs;
DROP POLICY IF EXISTS "Admins manage hubs insert" ON public.hubs;
DROP POLICY IF EXISTS "Authenticated can read hubs" ON public.hubs;
DROP POLICY IF EXISTS "Admins insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins manage roles delete" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage roles insert" ON public.user_roles;
DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;

-- 2. Drop old trigger + functions referencing user_roles
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role) CASCADE;

-- 3. Drop old user_roles table + enum (no longer used)
DROP TABLE IF EXISTS public.user_roles;
DROP TYPE IF EXISTS public.app_role;

-- 4. Add role column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'jefe_flota'
    CHECK (role IN ('admin','manager','jefe_flota','contable','customer'));

-- 5. Ensure hub-id FK + add UNIQUE on hub nombre
ALTER TABLE public.hubs
  DROP CONSTRAINT IF EXISTS hubs_nombre_key;
ALTER TABLE public.hubs
  ADD CONSTRAINT hubs_nombre_key UNIQUE (nombre);

-- 6. Create usuario_hubs join table
CREATE TABLE IF NOT EXISTS public.usuario_hubs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  hub_id uuid REFERENCES public.hubs(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, hub_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.usuario_hubs TO authenticated;
GRANT ALL ON public.usuario_hubs TO service_role;

ALTER TABLE public.usuario_hubs ENABLE ROW LEVEL SECURITY;

-- 7. Security-definer helper: returns the role for a given user (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = _user_id
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND role = 'admin')
$$;

-- 8. Recreate RLS policies

-- hubs
CREATE POLICY "Authenticated can read hubs" ON public.hubs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert hubs" ON public.hubs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update hubs" ON public.hubs
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete hubs" ON public.hubs
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- profiles
CREATE POLICY "Users read own or admin reads all" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "Users update own profile or admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "Admin or self insert profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "Admins delete profile" ON public.profiles
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- usuario_hubs
CREATE POLICY "Users read own hub mappings or admin" ON public.usuario_hubs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "Admins insert hub mappings" ON public.usuario_hubs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update hub mappings" ON public.usuario_hubs
  FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete hub mappings" ON public.usuario_hubs
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- 9. New handle_new_user trigger: first user becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count integer;
  assigned_role text;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;
  IF user_count = 0 THEN
    assigned_role := 'admin';
  ELSE
    assigned_role := 'jefe_flota';
  END IF;

  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    assigned_role
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
