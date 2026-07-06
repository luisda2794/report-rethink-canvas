import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import CD13HeatMap from "@/components/mapas/cd13-heat-map";

async function fetchCD13Snapshot() {
  const res = await fetch("/api/public/cd13");
  if (!res.ok) throw new Error("No se pudo cargar CD13");
  return res.json();
}

export const Route = createFileRoute("/cd13")({
  component: () => (
    <RequireAuth path="/cd13">
      <div style={{ height: "calc(100vh - 4rem)" }}>
        <CD13HeatMap fetchCD13Snapshot={fetchCD13Snapshot} />
      </div>
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Mapa de calor CD13 — Menssajero" },
      {
        name: "description",
        content: "Mapa de calor de paquetes CD13 (>13 días en almacén) por código postal en Alicante.",
      },
    ],
  }),
});
