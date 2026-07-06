import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import CD5HeatMap from "@/components/mapas/cd5-heat-map";

async function fetchCD5Snapshot() {
  const res = await fetch("/api/public/cd5");
  if (!res.ok) throw new Error("No se pudo cargar CD5");
  return res.json();
}

export const Route = createFileRoute("/cd5")({
  component: () => (
    <RequireAuth path="/cd5">
      <div style={{ height: "calc(100vh - 4rem)" }}>
        <CD5HeatMap fetchCD5Snapshot={fetchCD5Snapshot} />
      </div>
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Mapa de calor CD5 Alicante y Toledo — Menssajero" },
      {
        name: "description",
        content: "Mapa de calor de paquetes CD5 (>5 días en almacén) por código postal en Alicante y Toledo.",
      },
    ],
  }),
});
