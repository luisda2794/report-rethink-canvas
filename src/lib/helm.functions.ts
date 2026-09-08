import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ============================================================
// Helm — Fase 1: el "shell" de control del panel de orquestación de
// agentes de negocio (ventas/comunicaciones/finanzas). Define agentes,
// registra ejecuciones y aprobaciones, y lista integraciones — TODAVÍA
// ningún agente llama a un LLM real ni a una integración real, eso es
// fase posterior ya acordada con el usuario. Es un módulo separado del
// Equipo Operativo (agentes.functions.ts) — no comparte tablas ni lógica
// con ese, a propósito: Helm es de negocio (ventas/comunicaciones/
// finanzas), el Equipo Operativo es operativo/logístico y por hub.
//
// Tablas prefijadas "helm_" a propósito: si el usuario decide exportar
// este módulo como producto separado más adelante, ese prefijo hace la
// extracción limpia.
// ============================================================

export type HelmCategoria = "ventas" | "comunicaciones" | "finanzas";
export type HelmAgenteEstado = "activo" | "pausado" | "error";
export type HelmTipoDisparo = "manual" | "programado" | "evento";

export type HelmAgente = {
  id: string;
  nombre: string;
  categoria: HelmCategoria;
  descripcion: string | null;
  estado: HelmAgenteEstado;
  tipo_disparo: HelmTipoDisparo;
  cron_programado: string | null;
  ultima_ejecucion_en: string | null;
  creado_en: string;
};

export type HelmEjecucionEstado = "ejecutando" | "exito" | "fallo";

export type HelmEjecucionRow = {
  id: string;
  agente_id: string;
  agente_nombre: string;
  agente_categoria: HelmCategoria;
  iniciado_en: string;
  finalizado_en: string | null;
  estado: HelmEjecucionEstado;
  resumen: string | null;
  tareas_completadas: number;
};

export type HelmAprobacionEstado = "pendiente" | "aprobado" | "rechazado";

export type HelmAprobacionRow = {
  id: string;
  ejecucion_id: string | null;
  agente_id: string;
  agente_nombre: string;
  agente_categoria: HelmCategoria;
  descripcion_accion: string;
  estado: HelmAprobacionEstado;
  solicitado_en: string;
  decidido_en: string | null;
};

export type HelmIntegracion = {
  id: string;
  nombre: string;
  categoria: HelmCategoria | "general";
  estado: "conectado" | "desconectado";
  creado_en: string;
};

// Más simple que assertAccesoAgente (agentes.functions.ts): Helm no tiene
// scope por hub, es todo o nada por rol.
async function assertEsAdmin(supabase: any, userId: string): Promise<void> {
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  const role = profile?.role as string | undefined;
  if (role === "admin") return;
  throw new Error("Solo administradores pueden acceder a Helm.");
}

// ============================================================
// AGENTES
// ============================================================

export const listarAgentesHelm = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HelmAgente[]> => {
    await assertEsAdmin(context.supabase, context.userId);
    const { data, error } = await supabaseAdmin
      .from("helm_agentes")
      .select("id, nombre, categoria, descripcion, estado, tipo_disparo, cron_programado, ultima_ejecucion_en, creado_en")
      .order("categoria")
      .order("nombre");
    if (error) throw new Error(error.message);
    return (data ?? []) as HelmAgente[];
  });

// Fase 1: placeholder. No ejecuta lógica real de agente todavía (ni LLM ni
// integración real) — solo simula una corrida exitosa para poder probar el
// flujo completo (shell de control) de punta a punta. La lógica real de
// cada agente llega en una fase posterior ya acordada con el usuario.
const EjecutarAgenteSchema = z.object({ agente_id: z.string().uuid() });

export const ejecutarAgenteHelm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EjecutarAgenteSchema.parse(i))
  .handler(async ({ data, context }): Promise<void> => {
    await assertEsAdmin(context.supabase, context.userId);
    const tareasCompletadas = 1 + Math.floor(Math.random() * 8); // 1-8
    const ahora = new Date().toISOString();

    const { error: insertError } = await supabaseAdmin.from("helm_ejecuciones").insert({
      agente_id: data.agente_id,
      iniciado_en: ahora,
      finalizado_en: ahora,
      estado: "exito",
      resumen: "Ejecución manual completada.",
      tareas_completadas: tareasCompletadas,
      ejecutado_por: context.userId,
    });
    if (insertError) throw new Error(insertError.message);

    const { error: updateError } = await supabaseAdmin
      .from("helm_agentes")
      .update({ ultima_ejecucion_en: ahora })
      .eq("id", data.agente_id);
    if (updateError) throw new Error(updateError.message);
  });

// ============================================================
// EJECUCIONES
// ============================================================

const ListarEjecucionesSchema = z.object({ agente_id: z.string().uuid().optional() });

export const listarEjecucionesHelm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListarEjecucionesSchema.parse(i))
  .handler(async ({ data, context }): Promise<HelmEjecucionRow[]> => {
    await assertEsAdmin(context.supabase, context.userId);
    let query = supabaseAdmin
      .from("helm_ejecuciones")
      .select("id, agente_id, iniciado_en, finalizado_en, estado, resumen, tareas_completadas, agente:helm_agentes(nombre, categoria)")
      .order("iniciado_en", { ascending: false })
      .limit(200);
    if (data.agente_id) query = query.eq("agente_id", data.agente_id);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return ((rows ?? []) as unknown as Array<{
      id: string;
      agente_id: string;
      iniciado_en: string;
      finalizado_en: string | null;
      estado: HelmEjecucionEstado;
      resumen: string | null;
      tareas_completadas: number;
      agente: { nombre: string; categoria: HelmCategoria } | null;
    }>).map((r) => ({
      id: r.id,
      agente_id: r.agente_id,
      agente_nombre: r.agente?.nombre ?? "—",
      agente_categoria: r.agente?.categoria ?? "ventas",
      iniciado_en: r.iniciado_en,
      finalizado_en: r.finalizado_en,
      estado: r.estado,
      resumen: r.resumen,
      tareas_completadas: r.tareas_completadas,
    }));
  });

// ============================================================
// APROBACIONES
// ============================================================

const ListarAprobacionesSchema = z.object({
  estado: z.enum(["pendiente", "aprobado", "rechazado"]).optional(),
});

export const listarAprobacionesHelm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListarAprobacionesSchema.parse(i))
  .handler(async ({ data, context }): Promise<HelmAprobacionRow[]> => {
    await assertEsAdmin(context.supabase, context.userId);
    const estado = data.estado ?? "pendiente";
    const { data: rows, error } = await supabaseAdmin
      .from("helm_aprobaciones")
      .select("id, ejecucion_id, agente_id, descripcion_accion, estado, solicitado_en, decidido_en, agente:helm_agentes(nombre, categoria)")
      .eq("estado", estado)
      .order("solicitado_en", { ascending: false });
    if (error) throw new Error(error.message);
    return ((rows ?? []) as unknown as Array<{
      id: string;
      ejecucion_id: string | null;
      agente_id: string;
      descripcion_accion: string;
      estado: HelmAprobacionEstado;
      solicitado_en: string;
      decidido_en: string | null;
      agente: { nombre: string; categoria: HelmCategoria } | null;
    }>).map((r) => ({
      id: r.id,
      ejecucion_id: r.ejecucion_id,
      agente_id: r.agente_id,
      agente_nombre: r.agente?.nombre ?? "—",
      agente_categoria: r.agente?.categoria ?? "ventas",
      descripcion_accion: r.descripcion_accion,
      estado: r.estado,
      solicitado_en: r.solicitado_en,
      decidido_en: r.decidido_en,
    }));
  });

const DecidirAprobacionSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["aprobado", "rechazado"]),
});

export const decidirAprobacionHelm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DecidirAprobacionSchema.parse(i))
  .handler(async ({ data, context }): Promise<void> => {
    await assertEsAdmin(context.supabase, context.userId);
    const { error } = await supabaseAdmin
      .from("helm_aprobaciones")
      .update({
        estado: data.decision,
        decidido_en: new Date().toISOString(),
        decidido_por: context.userId,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
  });

// ============================================================
// INTEGRACIONES
// ============================================================

export const listarIntegracionesHelm = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HelmIntegracion[]> => {
    await assertEsAdmin(context.supabase, context.userId);
    const { data, error } = await supabaseAdmin
      .from("helm_integraciones")
      .select("id, nombre, categoria, estado, creado_en")
      .order("categoria")
      .order("nombre");
    if (error) throw new Error(error.message);
    return (data ?? []) as HelmIntegracion[];
  });

const ToggleIntegracionSchema = z.object({ id: z.string().uuid() });

export const toggleIntegracionHelm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ToggleIntegracionSchema.parse(i))
  .handler(async ({ data, context }): Promise<void> => {
    await assertEsAdmin(context.supabase, context.userId);
    const { data: row, error: readError } = await supabaseAdmin
      .from("helm_integraciones")
      .select("estado")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!row) throw new Error("Integración no encontrada.");
    const nuevoEstado = row.estado === "conectado" ? "desconectado" : "conectado";
    const { error: updateError } = await supabaseAdmin
      .from("helm_integraciones")
      .update({ estado: nuevoEstado })
      .eq("id", data.id);
    if (updateError) throw new Error(updateError.message);
  });
