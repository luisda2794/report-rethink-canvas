# Rehacer "Paquetes en Riesgo" (CD5/CD9 por horas y origen)

## Contradicciones / puntos a decidir con el código actual

1. **Borrar un ePOD deja de ser fiable.** Hoy cada línea de `epod_lineas` cuelga de su subida (`epod_upload_id`) y el botón de borrar elimina esas líneas. Con upsert por `task_code`, una tarea pertenece a la última exportación que la tocó: borrar la subida nueva se llevaría tareas que la antigua también traía, y borrar la antigua no borraría nada. Propuesta: al borrar, eliminar solo las tareas cuyo último `epod_upload_id` es esa subida (y avisarlo en el diálogo).
2. **Duplicados ya guardados.** Las líneas viejas no tienen `task_code`, así que el índice único no las deduplica (los NULL no chocan). Hasta re-subir, esos hubs mostrarán el aviso "sin horas" y la pantalla nueva ignorará filas sin `inbound_at`.
3. **Permisos.** `epod_lineas` hoy no permite UPDATE; el upsert necesita una política de UPDATE con el mismo filtro por hub que el INSERT.
4. **Las demás pantallas siguen leyendo filas duplicadas.** Dashboard/KPIs/Flow Meeting leen `epod_lineas` o `entregas` contando filas. Al pasar a upsert, una re-subida ya no añadirá filas: los números de esas pantallas pueden *bajar* (se vuelven correctos). No cambio su lógica, pero su resultado sí puede variar.
5. **`entregas`** mantiene su upsert actual por `(hub_id, lp_no)` con ignorar duplicados; no se toca.
6. **Motivo de fallo.** Hoy guardamos "Detalles de la Excepción" en `exception_detail`. "Delivery Fail Detail" es otra columna: R5–R7 usarán `fail_detail` y, si viene vacío, caerán a `exception_detail`. Confirmar.
7. **"Entrega".** El parser hoy normaliza el estado a `Entregado`; la regla usará `task_status_raw = 'Delivered'` o `estado = 'Entregado'`.
8. **R1 vs "Rompen hoy".** Un paquete recién llegado con una sola tarea `Assigned` quedaría excluido por R1 aunque sea real. Propuesta: aplicar R1 solo si esa única tarea tiene más de 24 h. Confirmar.
9. **R4 en días** (7 días = 168 h desde la última tarea) — se medirá en horas contra "ahora".
10. **Identificador.** Pides lp_no (o waybill); el código actual usa waybill antes que lp_no. Usaré `lp_no` y waybill solo si falta.
11. **Horas sin zona.** Se asume que las horas del ePOD y del nombre del archivo están en Europe/Madrid y se guardan como timestamptz convertidas.
12. **La pantalla actual** (`KpisRiesgoTab`: 3+ intentos y 5 días) desaparece de /paquetes-en-riesgo; `/reportes/paquetes-en-riesgo` y su función `paquetes_en_riesgo_stats` no se tocan.

## 1. Datos (migración aditiva)
- `epod_lineas` + columnas: `inbound_at, creation_at, delivered_at, failed_at, export_at` (timestamptz), `task_status_raw, delivery_type_raw, fail_detail, locker_pudo_id, task_code` (text).
- Índice único `(hub_id, task_code)` (parcial `WHERE task_code IS NOT NULL`) e índices `(hub_id, lp_no)`.
- Política UPDATE en `epod_lineas` por hub.
- Tabla `seller_origen` como pediste, con GRANT, RLS: lectura autenticados, escritura admin/manager. Sin seed.
- Tabla `hub_cp_excluidos(hub_id, cp)` para R2 (vacía), misma RLS.

## 2. Subida /epod
- Selector de varios archivos; se procesan uno a uno con progreso.
- Nuevos alias ES/EN para las columnas indicadas; fecha+hora leída de Excel (número serial o texto) en Madrid. Columnas antiguas siguen rellenándose.
- `export_at` del nombre (`YYYYMMDDHHMMSS`), si no hora de subida.
- Guardado vía función SQL `upsert_epod_lineas(jsonb)` que hace `INSERT … ON CONFLICT (hub_id, task_code) DO UPDATE … WHERE excluded.export_at >= epod_lineas.export_at` (una exportación más antigua no pisa). Filas sin task_code se insertan como hoy.

## 3. Cálculo en Postgres
Función `riesgo_cd_stats(_hub_id, _now default now())` (security invoker → RLS por hub):
- Agrupa tareas por paquete: inbound = MIN(inbound_at), entrega = MIN(delivered_at) de tareas Delivered, nº fallos, última tarea (por creation_at/failed_at), último motivo normalizado (sin acentos, minúsculas, U+00A0→espacio).
- Origen: `seller_origen` → reglas 1–4 (marketplaces, temu/shein/…, caracteres chinos/Warehouse/Foshan/Shenzhen) → Local.
- Reglas R0–R7 en orden, guarda la primera.
- En target y sin entregar/devolver: límite = inbound + 120 h (Local) / 216 h (China); grupo roto / hoy / mañana según hora Madrid; métrica CD5 (local ≤216 h) o CD9 (chino, o local pasado de 216 h).
- Devuelve jsonb: resumen por grupo×métrica, lista en riesgo, lista fuera de target, flag `sin_horas`.

## 4. Pantalla /paquetes-en-riesgo (nueva)
- Selector de hub actual, aviso "Vuelve a subir los ePOD para medir por horas".
- 6 tarjetas: Ya rotos / Rompen hoy / Rompen mañana × CD5/CD9.
- Tabla con todas las columnas pedidas, horas restantes o "roto hace X h", filtros grupo/origen/CP, orden rotos (más antiguo arriba) → hoy → mañana.
- Exportar Excel (xlsx ya en el proyecto).
- Sección plegable "Fuera de target" con paquete y regla.

## Detalles técnicos
- Archivos: migración nueva, `src/routes/epod.tsx` (parser + multiarchivo + upsert + borrado), `src/lib/kpis-riesgo.ts` reescrito (llamada RPC + tipos), `src/components/kpis-riesgo-tab.tsx` reescrito.
- Reglas de clasificación de origen y plazos también en `src/lib/riesgo-origen.ts` con tests vitest (marketplace, temu, chino, Local; 120/216 h; R5 sin acentos) para fijar las reglas; la fuente de verdad es la función SQL.
- Sin tocar Dashboard, KPIs, Flow Meeting, PUDOs, Facturación ni /reportes/paquetes-en-riesgo.
