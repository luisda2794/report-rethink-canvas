import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { KpisRiesgoTab } from "@/components/kpis-riesgo-tab";
import { useAuth } from "@/contexts/AuthContext";

export const Route = createFileRoute("/paquetes-en-riesgo")({
  component: () => (
    <RequireAuth path="/paquetes-en-riesgo">
      <PaquetesEnRiesgoPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Paquetes en Riesgo" },
      {
        name: "description",
        content: "Paquetes en reparto con 3+ intentos fallidos y 5+ días desde inbound.",
      },
    ],
  }),
});

function PaquetesEnRiesgoPage() {
  const { selectedHub } = useAuth();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Paquetes en Riesgo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hub: <span className="text-foreground font-semibold">{selectedHub ? `${selectedHub.marca} · ${selectedHub.nombre}` : "—"}</span>
        </p>
      </div>
      <KpisRiesgoTab hubId={selectedHub?.id ?? null} hubMarca={selectedHub?.marca ?? "hub"} />
    </div>
  );
}
