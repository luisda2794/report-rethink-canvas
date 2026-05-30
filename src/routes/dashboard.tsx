import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABEL } from "@/lib/roles";

export const Route = createFileRoute("/dashboard")({
  component: () => (
    <RequireAuth path="/dashboard">
      <DashboardPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Dashboard" }] }),
});

function DashboardPage() {
  const { profile, role, selectedHub, hubs } = useAuth();
  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Dashboard" />
      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-5xl mx-auto">
          <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4 flex items-center gap-2">
            <span className="size-1 bg-electric rounded-full" /> Vista general
          </div>
          <h1 className="text-4xl lg:text-5xl font-syne font-extrabold leading-[0.95] text-ink tracking-tighter uppercase mb-10">
            Hola{" "}
            <span className="font-playfair italic font-medium text-electric normal-case tracking-normal">
              {profile?.full_name?.split(" ")[0] ?? "operador"}
            </span>
          </h1>
          <div className="grid sm:grid-cols-3 gap-4">
            <Stat k="Rol" v={role ? ROLE_LABEL[role] : "—"} />
            <Stat k="Hub activo" v={selectedHub?.marca ?? "—"} />
            <Stat k="Hubs asignados" v={String(hubs.length)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="border border-hairline rounded-lg p-5 bg-surface">
      <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase mb-2">{k}</div>
      <div className="font-playfair italic font-extrabold text-ink text-3xl">{v}</div>
    </div>
  );
}
