## Plan: página /cd13 con el mapa de calor CD13

### Contexto
El componente `CD13HeatMap.tsx` existe pero está mal ubicado en `public/geo/src/components/` (dentro de `/public`, que solo sirve archivos estáticos y no compila TSX). Además no hay ninguna ruta que lo renderice. La API `/api/public/cd13` ya está lista.

### Cambios

1. **Mover el componente a su sitio**
   - Mover `public/geo/src/components/CD13HeatMap.tsx` → `src/components/mapas/cd13-heat-map.tsx`.
   - Eliminar la carpeta huérfana `public/geo/src/`.
   - Confirmar que el GeoJSON que usa (`/geo/alicante_cp_geometry.json`) exista en `public/geo/`; si no, reutilizar el GeoJSON activo de `mapa_versions` (mismo patrón que `use-mapa-dsp.ts`).

2. **Crear la ruta `/cd13`** (`src/routes/cd13.tsx`)
   - Protegida con `RequireAuth path="/cd13"` (acceso admin y manager, igual que `/mapas-provincia`).
   - `head()` propio: título "Mapa de calor CD13" y meta description.
   - Renderiza `<CD13HeatMap fetchCD13Snapshot={...} />` pasándole una función que hace `fetch('/api/public/cd13')` y devuelve las filas.
   - Envuelto en `AppShell` para mantener la topbar/sidebar del resto de páginas internas.

3. **Registrar la ruta en el sidebar y roles**
   - `src/lib/roles.ts`: añadir `/cd13` a `ROUTE_ACCESS` para admin y manager.
   - `src/components/app-shared.tsx`: añadir `/cd13` a `ALL_NAV`, `ICONS` (icono de mapa/calor) y `GROUP_OF` (grupo "Operación", junto a "Mapas por provincia").

4. **Verificación**
   - Login como admin en preview con Playwright, navegar a `/cd13`, comprobar que se renderiza el mapa y el panel lateral con los conteos, capturar pantalla.

### Notas técnicas
- No se toca la API `/api/public/cd13` ni la tabla `cd13_snapshots`; ya devuelven el formato que consume el componente.
- No se cambian estilos globales: el componente ya trae sus estilos inline. Se puede pulir después si se quiere alinear con el resto de la UI.
