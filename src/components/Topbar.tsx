import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/contexts/AuthContext";
import { ChevronDown, LogOut, Shield } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export function Topbar({ section }: { section: string }) {
  const { user, profile, hub, hubs, isAdmin, signOut, setActiveHubId } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (hubRef.current && !hubRef.current.contains(e.target as Node)) setHubOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const handleLogout = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  const displayName = profile?.full_name || user?.email || "Usuario";
  const initials = displayName
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="h-16 border-b border-hairline flex items-center justify-between px-6 lg:px-10 shrink-0 sticky top-0 bg-background/80 backdrop-blur-md z-40">
      <div className="flex items-center gap-3 min-w-0">
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <div className="size-8 bg-electric flex items-center justify-center rounded-md">
            <span className="font-playfair italic font-extrabold text-white text-lg leading-none">M</span>
          </div>
          <span className="font-playfair italic font-extrabold tracking-tight text-lg text-ink hidden sm:inline">
            Men<span className="text-electric">s</span>sajero
          </span>
        </Link>
        <span className="text-surface-3 hidden sm:inline">/</span>
        <span className="text-muted-text font-mono text-[11px] tracking-widest uppercase truncate hidden sm:inline">
          {section}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <nav className="flex items-center gap-1">
          <Link
            to="/reportes"
            className="px-3 py-1.5 text-xs font-syne font-semibold text-muted-text hover:text-ink rounded transition-colors"
            activeProps={{ className: "px-3 py-1.5 text-xs font-syne font-semibold text-ink bg-surface-2 rounded" }}
          >
            Reportes
          </Link>
          <Link
            to="/facturacion"
            className="px-3 py-1.5 text-xs font-syne font-semibold text-muted-text hover:text-ink rounded transition-colors"
            activeProps={{ className: "px-3 py-1.5 text-xs font-syne font-semibold text-ink bg-surface-2 rounded" }}
          >
            Facturación
          </Link>
          {isAdmin && (
            <Link
              to="/admin"
              className="px-3 py-1.5 text-xs font-syne font-semibold text-muted-text hover:text-ink rounded transition-colors inline-flex items-center gap-1"
              activeProps={{ className: "px-3 py-1.5 text-xs font-syne font-semibold text-ink bg-surface-2 rounded inline-flex items-center gap-1" }}
            >
              <Shield className="size-3" /> Admin
            </Link>
          )}
        </nav>

        {/* Hub selector (admin) or hub label (operator) */}
        {isAdmin ? (
          <div ref={hubRef} className="relative">
            <button
              onClick={() => setHubOpen((o) => !o)}
              className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 text-xs font-syne font-semibold text-ink bg-surface border border-hairline rounded hover:bg-surface-2 transition-colors"
            >
              <span className="size-1.5 bg-electric rounded-full" />
              Hub {hub?.marca ?? "—"}
              <ChevronDown className="size-3" />
            </button>
            {hubOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-background border border-hairline rounded-md shadow-lg overflow-hidden z-50">
                {hubs.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      setActiveHubId(h.id);
                      setHubOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm font-syne hover:bg-surface-2 transition-colors flex items-center justify-between ${
                      h.id === hub?.id ? "text-electric font-semibold" : "text-ink"
                    }`}
                  >
                    <span>{h.marca}</span>
                    <span className="font-mono text-[10px] text-muted-text uppercase">{h.ciudad}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : hub ? (
          <span className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 text-xs font-syne font-semibold text-ink bg-surface border border-hairline rounded">
            <span className="size-1.5 bg-electric rounded-full" />
            Hub {hub.marca}
          </span>
        ) : null}

        {/* User avatar */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="size-9 rounded-full bg-ink text-white font-syne font-bold text-xs flex items-center justify-center hover:brightness-110 transition-all"
          >
            {initials || "?"}
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-background border border-hairline rounded-md shadow-lg overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-hairline">
                <div className="font-syne font-bold text-sm text-ink truncate">{displayName}</div>
                <div className="font-mono text-[10px] text-muted-text uppercase tracking-widest mt-0.5 truncate">
                  {user?.email}
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2.5 text-sm font-syne text-ink hover:bg-surface-2 transition-colors inline-flex items-center gap-2"
              >
                <LogOut className="size-3.5" /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
