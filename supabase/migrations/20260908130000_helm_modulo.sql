-- Módulo Helm (Fase 1): orquestación de agentes de negocio agrupados por
-- categoría (ventas/comunicaciones/finanzas). Vive como su propio módulo
-- dentro de Menssajero, con tablas prefijadas `helm_` a propósito — el
-- usuario puede querer exportarlo como producto separado más adelante, y
-- ese prefijo hace la extracción limpia. Fase 1 es el "shell" de control:
-- define agentes, registra ejecuciones y aprobaciones — todavía NINGÚN
-- agente llama a un LLM real ni a una integración real, eso es fase
-- posterior ya acordada con el usuario.
CREATE TABLE IF NOT EXISTS public.helm_agentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  categoria text NOT NULL CHECK (categoria IN ('ventas','comunicaciones','finanzas')),
  descripcion text,
  estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','pausado','error')),
  tipo_disparo text NOT NULL DEFAULT 'manual' CHECK (tipo_disparo IN ('manual','programado','evento')),
  cron_programado text,
  ultima_ejecucion_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  creado_por uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.helm_ejecuciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL REFERENCES public.helm_agentes(id) ON DELETE CASCADE,
  iniciado_en timestamptz NOT NULL DEFAULT now(),
  finalizado_en timestamptz,
  estado text NOT NULL DEFAULT 'ejecutando' CHECK (estado IN ('ejecutando','exito','fallo')),
  resumen text,
  tareas_completadas integer NOT NULL DEFAULT 0,
  ejecutado_por uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.helm_aprobaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ejecucion_id uuid REFERENCES public.helm_ejecuciones(id) ON DELETE CASCADE,
  agente_id uuid NOT NULL REFERENCES public.helm_agentes(id) ON DELETE CASCADE,
  descripcion_accion text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
  solicitado_en timestamptz NOT NULL DEFAULT now(),
  decidido_en timestamptz,
  decidido_por uuid REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS public.helm_integraciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  categoria text NOT NULL CHECK (categoria IN ('ventas','comunicaciones','finanzas','general')),
  estado text NOT NULL DEFAULT 'desconectado' CHECK (estado IN ('conectado','desconectado')),
  creado_en timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.helm_agentes TO authenticated;
GRANT SELECT ON public.helm_ejecuciones TO authenticated;
GRANT SELECT ON public.helm_aprobaciones TO authenticated;
GRANT SELECT ON public.helm_integraciones TO authenticated;
GRANT ALL ON public.helm_agentes TO service_role;
GRANT ALL ON public.helm_ejecuciones TO service_role;
GRANT ALL ON public.helm_aprobaciones TO service_role;
GRANT ALL ON public.helm_integraciones TO service_role;

ALTER TABLE public.helm_agentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helm_ejecuciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helm_aprobaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helm_integraciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "helm_agentes_read" ON public.helm_agentes FOR SELECT TO authenticated
USING (is_admin(auth.uid()));
CREATE POLICY "helm_ejecuciones_read" ON public.helm_ejecuciones FOR SELECT TO authenticated
USING (is_admin(auth.uid()));
CREATE POLICY "helm_aprobaciones_read" ON public.helm_aprobaciones FOR SELECT TO authenticated
USING (is_admin(auth.uid()));
CREATE POLICY "helm_integraciones_read" ON public.helm_integraciones FOR SELECT TO authenticated
USING (is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_helm_agentes_categoria ON public.helm_agentes(categoria);
CREATE INDEX IF NOT EXISTS idx_helm_ejecuciones_agente_fecha ON public.helm_ejecuciones(agente_id, iniciado_en DESC);
CREATE INDEX IF NOT EXISTS idx_helm_aprobaciones_estado ON public.helm_aprobaciones(estado, solicitado_en DESC);

INSERT INTO public.helm_agentes (id, nombre, categoria, descripcion, estado, tipo_disparo, ultima_ejecucion_en) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Calificador de Leads', 'ventas', 'Puntúa leads nuevos según probabilidad de conversión.', 'activo', 'manual', now() - interval '2 hours'),
  ('a1000000-0000-0000-0000-000000000002', 'Redactor de Seguimiento', 'ventas', 'Redacta el mensaje de seguimiento cuando un lead lleva +24h sin contacto.', 'activo', 'evento', now() - interval '20 minutes'),
  ('a1000000-0000-0000-0000-000000000003', 'Puntuador de Oportunidades', 'ventas', 'Prioriza oportunidades abiertas por probabilidad de cierre.', 'pausado', 'programado', now() - interval '3 days'),
  ('a1000000-0000-0000-0000-000000000004', 'Triage de Tickets', 'comunicaciones', 'Clasifica tickets entrantes por urgencia y los enruta al equipo correcto.', 'activo', 'evento', now() - interval '5 minutes'),
  ('a1000000-0000-0000-0000-000000000005', 'Resumen Diario', 'comunicaciones', 'Genera el resumen de comunicaciones del día para el equipo.', 'activo', 'programado', now() - interval '12 hours'),
  ('a1000000-0000-0000-0000-000000000006', 'Bot de Facturación', 'finanzas', 'Prepara borradores de factura a partir de entregas confirmadas.', 'activo', 'manual', now() - interval '1 day'),
  ('a1000000-0000-0000-0000-000000000007', 'Agente de Previsión', 'finanzas', 'Proyecta ingresos de la semana contra la anterior.', 'error', 'programado', now() - interval '4 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.helm_ejecuciones (agente_id, iniciado_en, finalizado_en, estado, resumen, tareas_completadas) VALUES
  ('a1000000-0000-0000-0000-000000000001', now() - interval '2 hours 5 minutes', now() - interval '2 hours', 'exito', '12 leads calificados, 3 marcados como alta prioridad.', 12),
  ('a1000000-0000-0000-0000-000000000002', now() - interval '25 minutes', now() - interval '20 minutes', 'exito', '4 mensajes de seguimiento generados.', 4),
  ('a1000000-0000-0000-0000-000000000004', now() - interval '10 minutes', now() - interval '5 minutes', 'exito', '8 tickets clasificados y enrutados.', 8),
  ('a1000000-0000-0000-0000-000000000006', now() - interval '1 day 1 hour', now() - interval '1 day', 'exito', '6 borradores de factura preparados.', 6),
  ('a1000000-0000-0000-0000-000000000007', now() - interval '4 days 1 hour', now() - interval '4 days', 'fallo', 'No se pudo conectar con el origen de datos de la semana anterior.', 0)
ON CONFLICT DO NOTHING;

INSERT INTO public.helm_aprobaciones (agente_id, descripcion_accion, estado, solicitado_en) VALUES
  ('a1000000-0000-0000-0000-000000000002', 'Enviar mensaje de seguimiento a 4 leads sin contacto hace +24h.', 'pendiente', now() - interval '18 minutes'),
  ('a1000000-0000-0000-0000-000000000006', 'Emitir 2 facturas por un total de 1.240€ a clientes de esta semana.', 'pendiente', now() - interval '3 hours'),
  ('a1000000-0000-0000-0000-000000000004', 'Escalar ticket #4021 a soporte de nivel 2 por reincidencia.', 'pendiente', now() - interval '40 minutes')
ON CONFLICT DO NOTHING;

INSERT INTO public.helm_integraciones (nombre, categoria, estado) VALUES
  ('CRM', 'ventas', 'conectado'),
  ('Bandeja de entrada', 'comunicaciones', 'conectado'),
  ('Calendario', 'comunicaciones', 'desconectado'),
  ('Firma electrónica', 'finanzas', 'desconectado'),
  ('Contabilidad', 'finanzas', 'conectado')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
