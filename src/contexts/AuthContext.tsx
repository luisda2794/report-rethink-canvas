import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Hub = {
  id: string;
  nombre: string;
  marca: string;
  ciudad: string | null;
  activo: boolean;
};

export type Profile = {
  id: string;
  hub_id: string | null;
  full_name: string | null;
};

export type Role = "admin" | "operator";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  hub: Hub | null;
  hubs: Hub[];
  role: Role | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  setActiveHubId: (id: string) => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [activeHubId, setActiveHubId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = async (uid: string) => {
    const [{ data: prof }, { data: roleRows }, { data: hubRows }] = await Promise.all([
      supabase.from("profiles").select("id, hub_id, full_name").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("hubs").select("id, nombre, marca, ciudad, activo").order("marca"),
    ]);
    setProfile((prof as Profile) ?? null);
    const roles = (roleRows ?? []).map((r) => r.role as Role);
    setRole(roles.includes("admin") ? "admin" : roles.includes("operator") ? "operator" : null);
    setHubs((hubRows as Hub[]) ?? []);
    setActiveHubId((prev) => prev ?? (prof as Profile | null)?.hub_id ?? null);
  };

  useEffect(() => {
    // Set up listener first
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // defer to avoid potential recursion
        setTimeout(() => {
          void loadAll(s.user.id);
        }, 0);
      } else {
        setProfile(null);
        setHubs([]);
        setRole(null);
        setActiveHubId(null);
      }
    });

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) await loadAll(data.session.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const hub =
    hubs.find((h) => h.id === activeHubId) ??
    hubs.find((h) => h.id === profile?.hub_id) ??
    null;

  const value: AuthContextValue = {
    user,
    session,
    profile,
    hub,
    hubs,
    role,
    isAdmin: role === "admin",
    loading,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
    setActiveHubId: (id) => setActiveHubId(id),
    refresh: async () => {
      if (user) await loadAll(user.id);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
