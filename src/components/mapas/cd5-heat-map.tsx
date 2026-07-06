import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2 } from "lucide-react";

// ============================================================
// CONFIGURACIÓN — umbrales de color del mapa
// ============================================================
const UMBRAL_NARANJA_DESDE = 1; // >=1 paquete CD5 -> naranja
const UMBRAL_ROJO_DESDE = 5; // >=5 paquetes CD5 -> rojo

type ProvinciaKey = "alicante" | "toledo";

const PROVINCIAS: Record<
  ProvinciaKey,
  { label: string; geoUrl: string; center: [number, number]; zoom: number; prefix: string }
> = {
  alicante: {
    label: "Alicante",
    geoUrl: "/geo/alicante_cp_geometry.json",
    center: [38.45, -0.55],
    zoom: 9,
    prefix: "03",
  },
  toledo: {
    label: "Toledo",
    geoUrl: "/geo/toledo_cp_geometry.json",
    center: [39.86, -4.02],
    zoom: 9,
    prefix: "45",
  },
};

function colorFor(count: number): string {
  if (count >= UMBRAL_ROJO_DESDE) return "#dc2626";
  if (count >= UMBRAL_NARANJA_DESDE) return "#f59e0b";
  return "#16a34a";
}

interface CD5Row {
  cp: string;
  count: number;
  updated_at?: string;
  provincia?: string | null;
}

interface CD5HeatMapProps {
  fetchCD5Snapshot: () => Promise<CD5Row[]>;
}

export default function CD5HeatMap({ fetchCD5Snapshot }: CD5HeatMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.GeoJSON | null>(null);
  const countsRef = useRef<Record<string, number>>({});

  const [provincia, setProvincia] = useState<ProvinciaKey>("alicante");
  const [allRows, setAllRows] = useState<CD5Row[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layerReady, setLayerReady] = useState(false);

  // Filtra los rows en cliente según provincia
  const counts = useMemo(() => {
    const cfg = PROVINCIAS[provincia];
    const map: Record<string, number> = {};
    for (const r of allRows) {
      const prov = (r.provincia ?? "").trim();
      const matches = prov
        ? prov === cfg.prefix
        : (r.cp ?? "").startsWith(cfg.prefix);
      if (matches) map[r.cp] = r.count;
    }
    return map;
  }, [allRows, provincia]);

  // --- Inicializa el mapa (una sola vez) ---
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const cfg = PROVINCIAS[provincia];
    const map = L.map(mapContainerRef.current).setView(cfg.center, cfg.zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Carga/recarga del GeoJSON al cambiar de provincia ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cfg = PROVINCIAS[provincia];

    setLayerReady(false);
    if (layerRef.current) {
      layerRef.current.remove();
      layerRef.current = null;
    }

    map.setView(cfg.center, cfg.zoom);

    let cancelled = false;
    fetch(cfg.geoUrl)
      .then((res) => res.json())
      .then((geojson) => {
        if (cancelled || !mapRef.current) return;
        const layer = L.geoJSON(geojson, {
          style: () => ({
            fillColor: "#9ca3af",
            weight: 1,
            color: "#ffffff",
            fillOpacity: 0.75,
          }),
          onEachFeature: (feature, lyr) => {
            const path = lyr as L.Path;
            path.bindPopup("");
            path.on("mouseover", () => path.setStyle({ weight: 2, color: "#111827" }));
            path.on("mouseout", () => {
              const cp = feature.properties.cp;
              path.setStyle(styleForCp(cp));
            });
          },
        }).addTo(map);
        layerRef.current = layer;
        try {
          map.fitBounds(layer.getBounds().pad(0.02));
        } catch {
          /* noop */
        }
        setLayerReady(true);
      })
      .catch(() => setError("No se pudo cargar la geometría de códigos postales."));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provincia]);

  function styleForCp(cp: string) {
    const count = countsRef.current[cp] ?? 0;
    return {
      fillColor: colorFor(count),
      weight: 1,
      color: "#ffffff",
      fillOpacity: 0.75,
    };
  }

  // --- Carga / refresco de los datos CD5 (una sola vez + intervalo) ---
  async function refresh() {
    try {
      setLoading(true);
      const rows = await fetchCD5Snapshot();
      let latestUpdate: string | null = null;
      rows.forEach((r) => {
        if (r.updated_at && (!latestUpdate || r.updated_at > latestUpdate)) {
          latestUpdate = r.updated_at;
        }
      });
      setAllRows(rows);
      setLastUpdated(latestUpdate);
      setError(null);
    } catch (e) {
      setError("No se pudo cargar el snapshot de CD5.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mantén countsRef sincronizado con los counts filtrados
  useEffect(() => {
    countsRef.current = counts;
  }, [counts]);

  // Repinta el mapa cuando cambian los conteos o el layer
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.eachLayer((lyr: any) => {
      const cp = lyr.feature.properties.cp;
      const count = counts[cp] ?? 0;
      lyr.setStyle(styleForCp(cp));
      lyr.setPopupContent(popupHTML(cp, count));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, layerReady]);

  function popupHTML(cp: string, count: number) {
    const estado =
      count >= UMBRAL_ROJO_DESDE
        ? "Crítico"
        : count >= UMBRAL_NARANJA_DESDE
          ? "Alerta"
          : "OK";
    return `<div style="font-weight:700;font-size:14px;margin-bottom:6px">${cp}</div>
      <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0">
        <span style="color:#6b7280">CD5 en reparto</span><span style="font-weight:600">${count}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0">
        <span style="color:#6b7280">Estado</span><span style="font-weight:600;color:${colorFor(count)}">${estado}</span>
      </div>`;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rojos = Object.values(counts).filter((c) => c >= UMBRAL_ROJO_DESDE).length;
  const naranjas = Object.values(counts).filter(
    (c) => c >= UMBRAL_NARANJA_DESDE && c < UMBRAL_ROJO_DESDE,
  ).length;
  const verdes = Object.keys(counts).length - rojos - naranjas;

  const legend = [
    { color: "#16a34a", label: "0", count: verdes },
    { color: "#f59e0b", label: "1-4", count: naranjas },
    { color: "#dc2626", label: "5+", count: rojos },
  ];

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="h-full w-full bg-muted" />

      {/* Selector de provincia */}
      <div className="absolute top-3 left-3 z-[500] flex gap-1 rounded-md border border-border bg-background/95 p-1 shadow-sm">
        {(Object.keys(PROVINCIAS) as ProvinciaKey[]).map((key) => {
          const active = key === provincia;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setProvincia(key)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {PROVINCIAS[key].label}
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && total === 0 && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-background/70">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute top-16 left-3 z-[500] max-w-[70%] rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Compact legend overlay */}
      <div className="absolute bottom-3 right-3 z-[500] rounded-md border border-border bg-background/95 px-3 py-2 shadow-sm">
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          CD5 en reparto — {PROVINCIAS[provincia].label}
        </div>
        <div className="flex items-center gap-3">
          {legend.map((row) => (
            <div key={row.label} className="flex items-center gap-1.5">
              <span
                className="inline-block rounded-sm"
                style={{ width: 10, height: 10, background: row.color }}
              />
              <span className="text-xs font-medium tabular-nums">{row.label}</span>
            </div>
          ))}
        </div>
        {lastUpdated && (
          <div className="mt-1.5 text-[10px] text-muted-foreground">
            {new Date(lastUpdated).toLocaleString("es-ES")}
          </div>
        )}
      </div>
    </div>
  );
}
