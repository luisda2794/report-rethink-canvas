import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import type { Layer, PathOptions } from "leaflet";
import type { Feature } from "geojson";

import { patchLeafletDefaultIcon } from "@/components/mapas/leaflet-icons";
import {
  DSP_COLORS,
  type CpFeature,
  type CpFeatureCollection,
  type SlaFilter,
} from "@/components/mapas/types";
import "./mapa.css";

patchLeafletDefaultIcon();

type Props = {
  geojson: CpFeatureCollection;
  activeDsp: string | null;
  slaFilter: SlaFilter;
  onCpClick?: (feature: CpFeature) => void;
};

const ALICANTE_CENTER: [number, number] = [38.45, -0.5];
const ALICANTE_ZOOM = 9;

function styleFor(
  feature: Feature | undefined,
  activeDsp: string | null,
  slaFilter: SlaFilter,
): PathOptions {
  const props = (feature?.properties ?? {}) as CpFeature["properties"];
  const dsp = (props.dsp as string) ?? "-";
  const slaFijo = (props.sla_fijo as string | null) ?? null;

  let opacity = 1;
  if (activeDsp && dsp !== activeDsp) opacity = 0.15;
  if (slaFilter !== "all" && slaFijo !== slaFilter.toUpperCase()) {
    opacity = Math.min(opacity, 0.1);
  }

  const color = (DSP_COLORS as Record<string, string>)[dsp] ?? "#9ca3af";
  return {
    fillColor: color,
    color: "#374151",
    weight: 0.5,
    fillOpacity: 0.55 * opacity + 0.05,
    opacity,
  };
}

function FitBounds({ geojson }: { geojson: CpFeatureCollection }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.geoJSON(geojson);
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.05));
    }
  }, [geojson, map]);
  return null;
}

export function MapaView({ geojson, activeDsp, slaFilter, onCpClick }: Props) {
  const geoJsonRef = useRef<L.GeoJSON | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Re-apply style whenever filters change.
  useEffect(() => {
    const layer = geoJsonRef.current;
    if (!layer) return;
    layer.setStyle((feat) => styleFor(feat as Feature | undefined, activeDsp, slaFilter));
  }, [activeDsp, slaFilter, geojson]);

  const onEachFeature = (feature: CpFeature, layer: Layer) => {
    const props = feature.properties;
    const dsp = (props.dsp as string) ?? "-";
    const color = (DSP_COLORS as Record<string, string>)[dsp] ?? "#9ca3af";
    const cpId = props.cp;

    const popupHtml = `
      <div class="mapa-popup">
        <div class="mapa-popup__title">
          CP ${escapeHtml(props.cp)}
          <span class="mapa-popup__badge">${Number(props.volumen ?? 0)}/día</span>
        </div>
        <div class="mapa-popup__row">
          <span class="mapa-popup__k">DSP</span>
          <span class="mapa-popup__v">
            <span class="mapa-popup__swatch" style="background:${color}"></span>
            ${escapeHtml(dsp)}
          </span>
        </div>
        <div class="mapa-popup__row">
          <span class="mapa-popup__k">Hub</span>
          <span class="mapa-popup__v">${escapeHtml(props.hub ?? "—")}</span>
        </div>
        <div class="mapa-popup__row">
          <span class="mapa-popup__k">SLA Teórico</span>
          <span class="mapa-popup__v">${escapeHtml(props.sla_teorico ?? "—")}</span>
        </div>
        <div class="mapa-popup__row">
          <span class="mapa-popup__k">SLA Fijo</span>
          <span class="mapa-popup__v">${escapeHtml(props.sla_fijo ?? "—")}</span>
        </div>
      </div>
    `;

    if ("bindPopup" in layer && typeof layer.bindPopup === "function") {
      layer.bindPopup(popupHtml, { minWidth: 220 });
    }

    layer.on("mouseover", () => {
      setHoveredId(cpId);
      if ("setStyle" in layer && typeof layer.setStyle === "function") {
        (layer as L.Path).setStyle({ weight: 2, color: "#111827" });
      }
    });
    layer.on("mouseout", () => {
      setHoveredId((cur) => (cur === cpId ? null : cur));
      if ("setStyle" in layer && typeof layer.setStyle === "function") {
        (layer as L.Path).setStyle(styleFor(feature as Feature | undefined, activeDsp, slaFilter));
      }
    });
    layer.on("click", () => onCpClick?.(feature));
  };

  const key = useMemo(
    () => `${activeDsp ?? "_"}|${slaFilter}|${geojson.features.length}`,
    [activeDsp, slaFilter, geojson.features.length],
  );

  return (
    <div className="mapa-view">
      <MapContainer
        center={ALICANTE_CENTER}
        zoom={ALICANTE_ZOOM}
        scrollWheelZoom
        className="mapa-view__canvas"
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          subdomains={["a", "b", "c", "d"]}
          maxZoom={19}
        />
        <GeoJSON
          key={key}
          ref={(layer) => {
            geoJsonRef.current = layer as L.GeoJSON | null;
          }}
          data={geojson}
          style={(feat) => styleFor(feat as Feature | undefined, activeDsp, slaFilter)}
          onEachFeature={onEachFeature}
        />
        <FitBounds geojson={geojson} />
      </MapContainer>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
