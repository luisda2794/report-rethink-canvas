
- epod_lineas is upserted per (hub_id, task_code) via upsert_epod_lineas; newer export_at wins — keeps repeated ePOD exports from duplicating tasks.
- CD5/CD9 risk is computed only in SQL (riesgo_cd_stats); src/lib/riesgo-origen.ts mirrors rules for tests — Postgres stays the source of truth.
