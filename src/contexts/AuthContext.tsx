import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/roles";

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
  role: Role;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: Role | null;
  isAdmin: boolean;
  hubs: Hub[];
  selectedHub: Hub | null;
  setSelectedHub: (hub: Hub) => void;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [selectedHubId, setSelectedHubId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = async (uid: string) => {
    const [profRes, hubsJoinRes, allHubsRes] = await Promise.all([
      supabase.from("profiles").select("id, hub_id, full_name, role").eq("id", uid).maybeSingle(),
      supabase.from("usuario_hubs").select("hub:hubs(id, nombre, marca, ciudad, activo)").eq("user_id", uid),
      supabase.from("hubs").select("id, nombre, marca, ciudad, activo").order("marca"),
    ]);

    const prof = (profRes.data ?? null) as Profile | null;
    setProfile(prof);

    // Admins see all hubs; everyone else sees their assigned hubs only
    if (prof?.role === "admin") {
      setHubs(((allHubsRes.data ?? []) as Hub[]));
    } else {
      const list = (hubsJoinRes.data ?? [])
        .map((r) => (r as { hub: Hub | null }).hub)
        .filter((h): h is Hub => !!h);
      setHubs(list);
    }

    setSelectedHubId((prev) => {
      if (prev) return prev;
      if (prof?.hub_id) return prof.hub_id;
      const fromList =
        prof?.role === "admin"
          ? ((allHubsRes.data ?? [])[0] as Hub | undefined)?.id
          : ((hubsJoinRes.data ?? [])[0] as { hub: Hub | null } | undefined)?.hub?.id;
      return fromList ?? null;
    });
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => void loadAll(s.user.id), 0);
      } else {
        setProfile(null);
        setHubs([]);
        setSelectedHubId(null);
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

  const selectedHub =
    hubs.find((h) => h.id === selectedHubId) ?? hubs[0] ?? null;

  const value: AuthContextValue = {
    user,
    session,
    profile,
    role: profile?.role ?? null,
    isAdmin: profile?.role === "admin",
    hubs,
    selectedHub,
    setSelectedHub: (hub) => setSelectedHubId(hub.id),
    loading,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    signUp: async (email, password, fullName) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: { full_name: fullName },
        },
      });
      return { error: error?.message ?? null };
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
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
