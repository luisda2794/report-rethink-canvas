import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/contexts/AuthContext";
import { ChevronDown, LogOut } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { navForRole, ROLE_LABEL } from "@/lib/roles";
import { supabase } from "@/integrations/supabase/client";

export function Topbar({ section }: { section: string }) {
  const { user, profile, role, selectedHub, hubs, signOut, setSelectedHub } = useAuth();
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
  const initial = (displayName[0] ?? "?").toUpperCase();
  const navItems = navForRole(role);

  // Pending indicator: amber dot on /epod when hub has no entregas yet
  const [epodPending, setEpodPending] = useState(false);
  useEffect(() => {
    if (!selectedHub) { setEpodPending(false); return; }
    let cancelled = false;
    void (async () => {
      const { count } = await supabase
        .from("entregas")
        .select("id", { count: "exact", head: true })
        .eq("hub_id", selectedHub.id);
      if (!cancelled) setEpodPending((count ?? 0) === 0);
    })();
    return () => { cancelled = true; };
  }, [selectedHub?.id]);

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
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((n) => {
            const showDot = n.to === "/epod" && epodPending;
            return (
              <Link
                key={n.to}
                to={n.to as "/"}
                className="relative px-3 py-1.5 text-xs font-syne font-semibold text-muted-text hover:text-ink rounded transition-colors inline-flex items-center gap-1.5"
                activeProps={{ className: "relative px-3 py-1.5 text-xs font-syne font-semibold text-ink bg-surface-2 rounded inline-flex items-center gap-1.5" }}
              >
                {n.label}
                {showDot && (
                  <span
                    className="size-1.5 rounded-full bg-amber-500"
                    title="Sube un ePOD para empezar"
                    aria-label="Pendiente: subir ePOD"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Hub selector / badge */}
        {hubs.length > 1 ? (
          <div ref={hubRef} className="relative">
            <button
              onClick={() => setHubOpen((o) => !o)}
              className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 text-xs font-syne font-semibold text-ink bg-surface border border-hairline rounded hover:bg-surface-2 transition-colors"
            >
              <span className="size-1.5 bg-electric rounded-full" />
              {selectedHub?.marca ?? "Hub"}
              <ChevronDown className="size-3" />
            </button>
            {hubOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-background border border-hairline rounded-md shadow-lg overflow-hidden z-50">
                {hubs.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      setSelectedHub(h);
                      setHubOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm font-syne hover:bg-surface-2 transition-colors flex items-center justify-between ${
                      h.id === selectedHub?.id ? "text-electric font-semibold" : "text-ink"
                    }`}
                  >
                    <span>{h.marca}</span>
                    <span className="font-mono text-[10px] text-muted-text uppercase">{h.ciudad}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : selectedHub ? (
          <span className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 text-xs font-syne font-semibold text-ink bg-surface border border-hairline rounded">
            <span className="size-1.5 bg-electric rounded-full" />
            {selectedHub.marca}
          </span>
        ) : null}

        {/* Avatar */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="size-9 rounded-full bg-ink text-white font-syne font-bold text-sm flex items-center justify-center hover:brightness-110 transition-all"
          >
            {initial}
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-background border border-hairline rounded-md shadow-lg overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-hairline">
                <div className="font-syne font-bold text-sm text-ink truncate">{displayName}</div>
                <div className="font-mono text-[10px] text-muted-text uppercase tracking-widest mt-0.5 truncate">
                  {user?.email}
                </div>
                {role && (
                  <div className="font-mono text-[10px] text-electric uppercase tracking-widest mt-1">
                    {ROLE_LABEL[role]}
                  </div>
                )}
              </div>
              {/* Mobile nav inside menu */}
              <div className="md:hidden border-b border-hairline py-1">
                {navItems.map((n) => (
                  <Link
                    key={n.to}
                    to={n.to as "/"}
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm font-syne text-ink hover:bg-surface-2"
                  >
                    {n.label}
                  </Link>
                ))}
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
