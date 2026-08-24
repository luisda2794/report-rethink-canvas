import { useEffect, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";

import { patchLeafletDefaultIcon } from "@/components/mapas/leaflet-icons";
import { classifyEstado, STATUS_COLOR } from "@/components/mapas/mapa-entregas-status";
import type { EpodLineaRow } from "@/components/mapas/use-mapa-entregas";
import "./mapa.css";

patchLeafletDefaultIcon();

// Centro de respaldo (España peninsular) — en cuanto hay puntos, FitBounds
// ajusta la vista a ellos.
const DEFAULT_CENTER: [number, number] = [40.2, -3.7];
const DEFAULT_ZOOM = 6;

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points);
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));
  }, [points, map]);
  return null;
}

export function MapaEntregasView({ rows }: { rows: EpodLineaRow[] }) {
  const points = useMemo<[number, number][]>(
    () => rows.map((r) => [r.latitude as number, r.longitude as number]),
    [rows],
  );

  return (
    <div className="mapa-view">
      <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} scrollWheelZoom className="mapa-view__canvas">
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains={["a", "b", "c", "d"]}
          maxZoom={19}
        />
        {rows.map((r) => {
          const status = classifyEstado(r.estado);
          const color = STATUS_COLOR[status];
          return (
            <CircleMarker
              key={r.id}
              center={[r.latitude as number, r.longitude as number]}
              radius={6}
              pathOptions={{ color: "#ffffff", weight: 1, fillColor: color, fillOpacity: 0.9 }}
            >
              <Popup minWidth={220}>
                <div className="mapa-popup">
                  <div className="mapa-popup__title">Waybill {r.waybill || r.lp_no}</div>
                  <div className="mapa-popup__row">
                    <span className="mapa-popup__k">Estado</span>
                    <span className="mapa-popup__v">
                      <span className="mapa-popup__swatch" style={{ background: color }} />
                      {r.estado}
                    </span>
                  </div>
                  <div className="mapa-popup__row">
                    <span className="mapa-popup__k">CP</span>
                    <span className="mapa-popup__v">{r.cp || "—"}</span>
                  </div>
                  <div className="mapa-popup__row">
                    <span className="mapa-popup__k">Dirección</span>
                    <span className="mapa-popup__v">{r.direccion || "—"}</span>
                  </div>
                  <div className="mapa-popup__row">
                    <span className="mapa-popup__k">Driver</span>
                    <span className="mapa-popup__v">{r.driver || "— Sin asignar —"}</span>
                  </div>
                  {status === "incidencia" && r.exception_detail && (
                    <div className="mapa-popup__row">
                      <span className="mapa-popup__k">Incidencia</span>
                      <span className="mapa-popup__v">{r.exception_detail}</span>
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
        <FitBounds points={points} />
      </MapContainer>
    </div>
  );
}
