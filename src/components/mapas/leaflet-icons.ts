// Workaround for the well-known Leaflet + bundler default-marker icon issue.
// Leaflet ships its icon assets at `leaflet/dist/images/*` and tries to resolve
// them by relative URL; with Vite/TanStack the resolved URL is broken. We just
// point Leaflet at the CDN images, which are stable and small. (Our map only
// uses vector polygons, so markers are not actually rendered — but we still
// fix the default icon to avoid console noise if a marker is ever added.)
import L from "leaflet";

let patched = false;

export function patchLeafletDefaultIcon(): void {
  if (patched) return;
  patched = true;
  // @ts-expect-error -- Leaflet's Icon.Default internals are not fully typed
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}
