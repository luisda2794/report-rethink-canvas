import { useMemo, useState } from "react";
import { AlertCircle, Loader2, MapPin } from "lucide-react";

import { useMapaDsp } from "@/components/mapas/use-mapa-dsp";
import { MapaView } from "@/components/mapas/mapa-view";
import { MapaSidebar } from "@/components/mapas/mapa-sidebar";
import type { SlaFilter } from "@/components/mapas/types";

export function MapaDspAlicante() {
  const { data, isLoading, isError, error, refetch } = useMapaDsp();
  const [activeDsp, setActiveDsp] = useState<string | null>(null);
  const [slaFilter, setSlaFilter] = useState<SlaFilter>("all");

  const perDsp = useMemo(() => {
    const out: Record<string, number> = {};
    if (!data) return out;
    for (const f of data.geojson.features) {
      const dsp = (f.properties.dsp as string) ?? "-";
      out[dsp] = (out[dsp] ?? 0) + Number(f.properties.volumen ?? 0);
    }
    return out;
  }, [data]);

  const toggleDsp = (dsp: string) => {
    setActiveDsp((cur) => (cur === dsp ? null : dsp));
  };

  if (isLoading) {
    return (
      <div className="mapa-loading">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <span>Cargando mapa de Alicante…</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mapa-error">
        <AlertCircle className="size-5 text-destructive" />
        <div className="flex-1">
          <p className="font-medium">No se pudo cargar el mapa</p>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error
              ? error.message
              : "Error desconocido al obtener el GeoJSON desde Supabase Storage."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-xs font-medium underline underline-offset-2 hover:text-foreground"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="mapa-page">
      <header className="mapa-page__header">
        <div className="flex items-center gap-2">
          <MapPin className="size-5 text-muted-foreground" />
          <div>
            <h1 className="mapa-page__title">Mapas Provincia</h1>
            <p className="mapa-page__subtitle">
              Visualización de la asignación de transportistas por código postal.
            </p>
          </div>
        </div>
      </header>

      <div className="mapa-page__grid">
        <div className="mapa-page__map">
          <MapaView geojson={data.geojson} activeDsp={activeDsp} slaFilter={slaFilter} />
        </div>
        <aside className="mapa-page__sidebar">
          <MapaSidebar
            totalCp={data.meta.totalCp}
            totalVolumen={data.meta.totalVolumen}
            perDsp={perDsp}
            activeDsp={activeDsp}
            slaFilter={slaFilter}
            onToggleDsp={toggleDsp}
            onChangeSla={setSlaFilter}
          />
        </aside>
      </div>
    </div>
  );
}
