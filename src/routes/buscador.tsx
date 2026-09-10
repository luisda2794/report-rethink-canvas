import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { BuscadorPaquetes } from "@/components/buscador-paquetes";

export const Route = createFileRoute("/buscador")({
  component: () => (
    <RequireAuth path="/buscador">
      <BuscadorPaquetesPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Buscador de Paquetes" },
      {
        name: "description",
        content: "Busca un paquete por Waybill o LP: trayectoria completa, intentos de entrega, incidencias y CD actual.",
      },
    ],
  }),
});

function BuscadorPaquetesPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Buscador de Paquetes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trayectoria completa, intentos de entrega, incidencias y CD actual de un paquete.
        </p>
      </div>
      <BuscadorPaquetes />
    </div>
  );
}
