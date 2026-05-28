import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/contexts/AuthContext";

export function RequireAuth({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
    else if (adminOnly && !isAdmin) navigate({ to: "/reportes" });
  }, [loading, user, isAdmin, adminOnly, navigate]);

  if (loading || !user || (adminOnly && !isAdmin)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="font-mono text-xs text-muted-text tracking-widest uppercase">Cargando…</div>
      </div>
    );
  }
  return <>{children}</>;
}
