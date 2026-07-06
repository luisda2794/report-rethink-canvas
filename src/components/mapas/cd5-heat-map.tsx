import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ============================================================
// CONFIGURACIÓN — ajusta aquí umbrales y origen de datos
// ============================================================
const UMBRAL_NARANJA_DESDE = 1; // >=1 paquete CD5 -> naranja
const UMBRAL_ROJO_DESDE = 5; // >=5 paquetes CD5 -> rojo

// Ruta del GeoJSON de fronteras (estático, no cambia).
// Colócalo en /public/geo/alicante_cp_geometry.json
const GEO_URL = "/geo/alicante_cp_geometry.json";

function colorFor(count: number): string {
  if (count >= UMBRAL_ROJO_DESDE) return "#dc2626";
  if (count >= UMBRAL_NARANJA_DESDE) return "#f59e0b";
  return "#16a34a";
}

interface CD5Row {
  cp: string;
  count: number;
  updated_at?: string;
}

interface CD5HeatMapProps {
  // Inyecta aquí tu cliente Supabase (el de Lovable ya trae uno integrado,
  // normalmente en "@/integrations/supabase/client").
  // Se espera un array de filas { cp, count, updated_at } ya calculado
  // en la tabla cd5_snapshots (ver prompt de configuración de base de datos).
  fetchCD5Snapshot: () => Promise<CD5Row[]>;
}

export default function CD5HeatMap({ fetchCD5Snapshot }: CD5HeatMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.GeoJSON | null>(null);

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layerReady, setLayerReady] = useState(false);
  const countsRef = useRef<Record<string, number>>({});


  // --- Carga inicial del mapa y la geometría ---
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current).setView([38.45, -0.55], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(map);
    mapRef.current = map;

    fetch(GEO_URL)
      .then((res) => res.json())
      .then((geojson) => {
        const layer = L.geoJSON(geojson, {
          style: () => ({ fillColor: "#9ca3af", weight: 1, color: "#fff", fillOpacity: 0.75 }),
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
        map.fitBounds(layer.getBounds().pad(0.02));
        setLayerReady(true);
      })
      .catch(() => setError("No se pudo cargar la geometría de códigos postales."));

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function styleForCp(cp: string) {
    const count = countsRef.current[cp] ?? 0;
    return { fillColor: colorFor(count), weight: 1, color: "#fff", fillOpacity: 0.75 };
  }

  // --- Carga / refresco de los datos CD5 ---
  async function refresh() {
    try {
      setLoading(true);
      const rows = await fetchCD5Snapshot();
      const map: Record<string, number> = {};
      let latestUpdate: string | null = null;
      rows.forEach((r) => {
        map[r.cp] = r.count;
        if (r.updated_at && (!latestUpdate || r.updated_at > latestUpdate)) {
          latestUpdate = r.updated_at;
        }
      });
      countsRef.current = map;
      setCounts(map);
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
    // Los datos se recalculan 2x/día (10:00 y 12:00) en el backend,
    // así que en el frontend basta con refrescar cada pocos minutos
    // por si el usuario deja la pestaña abierta durante el cambio.
    const interval = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repinta el mapa cuando cambian los conteos
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
    const estado = count >= UMBRAL_ROJO_DESDE ? "Crítico" : count >= UMBRAL_NARANJA_DESDE ? "Alerta" : "OK";
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
  const naranjas = Object.values(counts).filter((c) => c >= UMBRAL_NARANJA_DESDE && c < UMBRAL_ROJO_DESDE).length;
  const verdes = Object.keys(counts).length - rojos - naranjas;
  const ranking = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 500 }}>
      <div ref={mapContainerRef} style={{ flex: 1, background: "#f8fafc" }} />
      <div
        style={{
          width: 320,
          borderLeft: "1px solid #e5e7eb",
          background: "#fafafa",
          padding: 16,
          overflowY: "auto",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <h2 style={{ fontSize: 17, margin: "0 0 2px 0" }}>🔥 Mapa de calor CD5</h2>
        <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 16 }}>
          Alicante · paquetes &gt;5 días en almacén, en reparto
        </div>

        {error && (
          <div style={{ background: "#fef2f2", color: "#991b1b", fontSize: 12, padding: 8, borderRadius: 6, marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{loading ? "–" : total}</div>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>CD5 en reparto</div>
          </div>
          <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{loading ? "–" : rojos}</div>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>CPs en rojo</div>
          </div>
        </div>

        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#9ca3af", fontWeight: 600, margin: "16px 0 8px" }}>
          Umbrales
        </div>
        {[
          { color: "#16a34a", label: "Verde", val: `${verdes} CPs` },
          { color: "#f59e0b", label: "Naranja", val: `${naranjas} CPs (1-4)` },
          { color: "#dc2626", label: "Rojo", val: `${rojos} CPs (5+)` },
        ].map((row) => (
          <div key={row.label} style={{ display: "flex", alignItems: "center", padding: "8px 10px", borderRadius: 6, marginBottom: 4, background: "white", border: "1px solid #e5e7eb" }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, marginRight: 10, background: row.color }} />
            <div style={{ flex: 1, fontSize: 12.5, fontWeight: 500 }}>{row.label}</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{row.val}</div>
          </div>
        ))}

        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#9ca3af", fontWeight: 600, margin: "16px 0 8px" }}>
          CPs con más CD5
        </div>
        {ranking.map(([cp, count]) => (
          <div key={cp} style={{ display: "flex", justifyContent: "space-between", padding: "6px 4px", borderBottom: "1px solid #f3f4f6", fontSize: 12 }}>
            <span>
              <span style={{ width: 8, height: 8, borderRadius: 2, display: "inline-block", marginRight: 6, background: colorFor(count) }} />
              {cp}
            </span>
            <strong>{count}</strong>
          </div>
        ))}

        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 12 }}>
          {lastUpdated ? `Última actualización: ${new Date(lastUpdated).toLocaleString("es-ES")}` : "Sin datos aún"}
        </div>
      </div>
    </div>
  );
}
