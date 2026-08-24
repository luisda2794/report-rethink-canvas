import { createFileRoute } from "@tanstack/react-router";

import { RequireAuth } from "@/components/RequireAuth";
import { MapaEntregas } from "@/components/mapas/mapa-entregas";

export const Route = createFileRoute("/mapa-entregas")({
  component: () => (
    <RequireAuth path="/mapa-entregas">
      <MapaEntregas />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Mapa de Entregas — Menssajero" },
      {
        name: "description",
        content: "Mapa en vivo de los paquetes del día por hub, coloreado por estado de entrega.",
      },
    ],
  }),
});
