import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import CD5HeatMap from "@/components/mapas/cd5-heat-map";

async function fetchCD5Snapshot() {
  const res = await fetch("/api/public/cd5");
  if (!res.ok) throw new Error("No se pudo cargar CD5");
  return res.json();
}

function MapaCD5Card() {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Mapa de calor CD5</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="h-[320px] w-full overflow-hidden rounded-b-lg">
          <CD5HeatMap fetchCD5Snapshot={fetchCD5Snapshot} />
        </div>
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { selectedHub } = useAuth();

  if (!selectedHub) {
    return (
      <Card className="shadow-none">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Selecciona un hub para ver las métricas.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <MapaCD5Card />
    </div>
  );
}

