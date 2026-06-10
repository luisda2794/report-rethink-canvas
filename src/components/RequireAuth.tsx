import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/contexts/AuthContext";
import { canAccess, firstAllowedRoute } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";

export function RequireAuth({
  children,
  path,
  adminOnly = false,
}: {
  children: ReactNode;
  /** Route this guard protects, used for role-based access checks (e.g. "/reportes"). */
  path?: string;
  adminOnly?: boolean;
}) {
  const { user, loading, role } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/login" });
      return;
    }
    if (adminOnly && role !== "admin") {
      navigate({ to: firstAllowedRoute(role) as "/" });
      return;
    }
    if (path && role && !canAccess(role, path)) {
      navigate({ to: firstAllowedRoute(role) as "/" });
    }
  }, [loading, user, role, adminOnly, path, navigate]);

  const blocked =
    loading ||
    !user ||
    (adminOnly && role !== "admin") ||
    (path && role && !canAccess(role, path));

  if (blocked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="font-mono text-xs text-muted-text tracking-widest uppercase">Cargando…</div>
      </div>
    );
  }
  return <>{children}</>;
}
