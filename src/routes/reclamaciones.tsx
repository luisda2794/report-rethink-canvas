import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";

export const Route = createFileRoute("/reclamaciones")({
  component: () => (
    <RequireAuth path="/reclamaciones">
      <ReclamacionesPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Reclamaciones" }] }),
});

function ReclamacionesPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Reclamaciones" />
      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-5xl mx-auto">
          <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4 flex items-center gap-2">
            <span className="size-1 bg-electric rounded-full" /> Atención al cliente
          </div>
          <h1 className="text-4xl lg:text-5xl font-syne font-extrabold leading-[0.95] text-ink tracking-tighter uppercase mb-6">
            Gestión de{" "}
            <span className="font-playfair italic font-medium text-electric normal-case tracking-normal">
              reclamaciones
            </span>
          </h1>
          <p className="text-muted-text max-w-2xl">
            Próximamente: bandeja de incidencias y reclamaciones por hub.
          </p>
        </div>
      </div>
    </div>
  );
}
