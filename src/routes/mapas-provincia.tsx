import { createFileRoute } from "@tanstack/react-router";

import { RequireAuth } from "@/components/RequireAuth";
import { MapaDspAlicante } from "@/components/mapas/mapa-dsp-alicante";

export const Route = createFileRoute("/mapas-provincia")({
  component: () => (
    <RequireAuth path="/mapas-provincia">
      <MapaDspAlicante />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Mapas Provincia — Menssajero" },
      {
        name: "description",
        content: "Visualización de la asignación de transportistas por código postal en Alicante.",
      },
    ],
  }),
});
