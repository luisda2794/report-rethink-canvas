# Plan: Actualizar el mapa mediante CSV y GeoJSON

## Resumen
Convertimos el mapa de un archivo GeoJSON estático a un sistema versionado: la geometría (polígonos) se actualiza subiendo un nuevo GeoJSON, y los datos operativos por código postal (volumen, DSP, SLA, hub) se actualizan mediante CSV. Admin y manager pueden gestionar las versiones desde una nueva pantalla.

## 1. Modelo de datos

Crear dos tablas en la base de datos:

### `public.mapa_versions`
Guarda cada versión del mapa subida.

- `id` uuid
- `nombre` text (ej. "Abril 2025")
- `geojson_path` text (ruta en el bucket `mapas`, ej. `v2/alicante.geojson`)
- `activa` boolean
- `creado_por` uuid (referencia a auth.users)
- `created_at`, `updated_at`

### `public.mapa_cp_data`
Guarda los datos operativos por código postal, vinculados a una versión.

- `id` uuid
- `version_id` uuid (referencia a mapa_versions)
- `cp` text
- `dsp` text
- `hub_id` uuid (referencia a hubs, opcional)
- `sla_teorico` text
- `sla_fijo` text
- `volumen` numeric
- `updated_at`

RLS: solo admin y manager pueden leer, insertar, actualizar y eliminar. Todos los demás roles solo lectura. Incluir GRANTs y triggers de `updated_at`.

## 2. Backend (server functions)

Crear funciones en `src/lib/mapas.functions.ts`:

- `listMapaVersions()`: lista todas las versiones con conteo de CP.
- `getActiveMapaVersion()`: devuelve la versión activa y sus datos por CP.
- `createMapaVersion({ nombre, geojsonFile })`: sube el GeoJSON al bucket `mapas` con un nombre único, crea el registro y lo activa (desactivando la anterior).
- `activateMapaVersion({ version_id })`: cambia la versión activa.
- `bulkUpsertCpData({ version_id, csvText })`: parsea CSV, valida columnas (cp, dsp, hub, sla_teorico, sla_fijo, volumen), hace upsert en `mapa_cp_data`.
- `deleteMapaVersion({ version_id })`: elimina versión, datos asociados y archivo de storage.

Todas las funciones de escritura requieren rol admin o manager (`requireSupabaseAuth` + verificación de rol).

## 3. Frontend de administración

Crear nueva ruta `/mapas-admin` accesible para admin y manager (protegida con `RequireAuth path="/mapas-admin"`).

Pantalla con dos tarjetas:

- **Versiones del mapa**: listado con nombre, fecha, activa, cantidad de CP. Botones para activar, subir nueva versión (GeoJSON + nombre) y eliminar.
- **Datos por CP**: área para pegar CSV o subir archivo `.csv`. Vista previa de filas detectadas. Botón "Importar" para ejecutar el upsert. Muestra total de CP y volumen de la versión activa.

Añadir la ruta a `ALL_NAV`, `ROUTE_ACCESS` para admin y manager, y a `ICONS`/`GROUP_OF` en `app-shared.tsx` para que aparezca en el sidebar.

## 4. Adaptar el mapa actual

Modificar `src/components/mapas/use-mapa-dsp.ts` para que:

- Llame a `getActiveMapaVersion()`.
- Descargue el GeoJSON de la ruta indicada por la versión activa.
- Combine geometría del GeoJSON con datos de `mapa_cp_data` por `cp`: si un CP existe en la tabla, sus propiedades prevalecen sobre las del GeoJSON; si no existe, usa las del GeoJSON.
- Devuelva el mismo objeto de datos que ahora (`geojson + meta`) para no romper `MapaView` ni `MapaSidebar`.

## 5. Flujo de actualización esperado

1. Admin/manager entra en `/mapas-admin`.
2. Si cambian los polígonos: sube un nuevo GeoJSON, se crea una versión y se activa.
3. Si cambian los datos: sube/pegue un CSV y se actualiza `mapa_cp_data` de la versión activa.
4. El mapa `/mapas-provincia` se recarga automáticamente con la nueva combinación.

## 6. Formato CSV esperado

```csv
cp,dsp,hub,sla_teorico,sla_fijo,volumen
03001,DKNS Transportes S.L.,Alicante Centro,T+1,T+1,120
03002,Luan Express SL,Alicante Norte,T+2,T+2,85
```

Columna `cp` obligatoria. Las demás son opcionales: si faltan, se conservan los valores del GeoJSON o de la importación anterior.

## 7. Detalles técnicos

- Bucket: reutilizar `mapas` (ya existe y es público). Los archivos GeoJSON se guardarán con prefijo de versión para evitar sobreescrituras accidentales.
- Parser CSV: usar `papaparse` (instalar vía `bun add papaparse` + tipos `@types/papaparse`).
- Validación: usar Zod en el server function para validar filas y rechazar CSV con errores graves.
- Transacción: envolver el upsert en una transacción para evitar estados inconsistentes.