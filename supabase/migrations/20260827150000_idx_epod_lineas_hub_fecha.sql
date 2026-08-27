-- Mapa de Entregas consulta epod_lineas filtrando por (hub_id, fecha). Ya
-- existe un índice (hub_id, estado) pero no uno para este par de columnas —
-- se agrega para acelerar la consulta del mapa por día.
CREATE INDEX IF NOT EXISTS idx_epod_lineas_hub_fecha ON public.epod_lineas(hub_id, fecha);
