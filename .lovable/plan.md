# Plan: Ruta "Mapas Provincia" con mapa coroplético de Alicante

## 1. Dependencias
Instalar con `bun add`:
- `leaflet@^1.9.4`
- `react-leaflet@^5.0.0`
- `@types/leaflet@^1.9.20` (dev)

## 2. Archivos nuevos
Crearé estos 8 archivos con el contenido que me pegarás:
- `src/components/mapas/types.ts`
- `src/components/mapas/leaflet-icons.ts`
- `src/components/mapas/use-mapa-dsp.ts`
- `src/components/mapas/mapa.css`
- `src/components/mapas/mapa-view.tsx`
- `src/components/mapas/mapa-sidebar.tsx`
- `src/components/mapas/mapa-dsp-alicante.tsx`
- `src/routes/mapas-provincia.tsx` (usará `createFileRoute("/mapas-provincia")` y `RequireAuth` con `path="/mapas-provincia"`)

## 3. Modificaciones
- **`src/lib/roles.ts`**:
  - Añadir `{ to: "/mapas-provincia", label: "Mapas Provincia" }` a `ALL_NAV`.
  - Añadir `"/mapas-provincia"` a `ROUTE_ACCESS.admin` y `ROUTE_ACCESS.manager`.
- **`src/components/app-shared.tsx`**:
  - Importar `MapIcon` de `lucide-react`.
  - Añadir `"/mapas-provincia": <MapIcon />` a `ICONS`.
  - Añadir `"/mapas-provincia": "Operación"` a `GROUP_OF`.

## 4. Sidebar y acceso
La ruta aparecerá automáticamente en el grupo "Operación" del sidebar (vía `buildNavGroups`) solo para admin/manager, gracias a los cambios en `roles.ts` + `app-shared.tsx`.

## 5. GeoJSON desde Storage
El hook `use-mapa-dsp.ts` leerá:
- `import.meta.env.VITE_MAPAS_BUCKET` (default `"mapas"`)
- `import.meta.env.VITE_MAPA_ALICANTE_PATH` (default `"alicante.geojson"`)

Notas de backend (fuera del scope de esta tarea, para tener en cuenta después):
- El bucket `mapas` no existe todavía en el proyecto (solo hay `rec-evidencias`). Habrá que crearlo (público o con policy de lectura para authenticated) y subir `alicante.geojson` para que el mapa cargue datos. Puedo hacerlo en un turno posterior si quieres.

---

Cuando apruebes el plan, pégame el contenido de los 8 archivos y lo aplico tal cual (más los 2 edits de `roles.ts` y `app-shared.tsx`).
