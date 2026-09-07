import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchCd5Rows, computeCd5Trend } from "@/lib/kpis-cd5";
import { fetchPudoLineas, computePuntos, ALERT_THRESHOLD_M } from "@/lib/pudos-calc";
import { isoAddDays } from "@/lib/business-days";

// ============================================================
// Equipo Operativo — Fase 1: los 6 trabajadores.
//
// Cada uno es un server function (createServerFn), NO una Edge Function ni
// una función de Postgres nueva — decisión explícita del Paso 0: CD5 y el
// gap de PUDO viven a propósito como TypeScript plano (no SQL) para evitar
// el mismo problema de migraciones/funciones que quedan escritas pero nunca
// llegan a producción que ya pasó varias veces en este proyecto. Un server
// function corre 100% server-side (con supabaseAdmin, sin RLS ni sesión de
// navegador de por medio) reutilizando esa misma lógica sin duplicarla —
// mismo resultado de automatización que una Edge Function, sin agregar una
// pieza de infraestructura nueva para probar los 6 de forma independiente
// en esta fase (el cron real, cuando llegue, solo necesita disparar estos
// mismos endpoints).
//
// IMPORTANTE — no inventado, real: ninguno de estos agentes "decide" nada
// todavía. Cada uno solo lee y devuelve hallazgos estructurados. El Agente
// Jefe (fase posterior, todavía sin construir) es el único que interpreta.
// ============================================================

export type Urgencia = "critica" | "informativa";
export type Hallazgo = Record<string, unknown> & { titulo: string; detalle: string };
export type ResultadoAgente = {
  agente: string;
  hub_id: string | null;
  hallazgos: Hallazgo[];
  urgencia: Urgencia;
};

// A diferencia de mapas.functions.ts (un recurso único, no por hub), acá los
// datos SÍ son por hub — mismo criterio que el resto de la app (confirmado
// varias veces esta sesión, ej. fix_manager_hub_access.sql): manager se
// comporta igual que jefe_flota, solo ve los hubs de su usuario_hubs; SOLO
// admin ve todos. Si hubId es null (vista agregada, ej. el historial sin
// filtrar), únicamente admin puede pedirla.
async function assertAccesoAgente(supabase: any, userId: string, hubId: string | null): Promise<void> {
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  const role = profile?.role as string | undefined;
  if (role === "admin") return;
  if (role !== "manager") {
    throw new Error("Solo administradores o managers pueden ejecutar agentes.");
  }
  if (!hubId) {
    throw new Error("Un manager tiene que elegir un hub — la vista sin filtrar es solo para admin.");
  }
  const { data: uh } = await supabase
    .from("usuario_hubs")
    .select("hub_id")
    .eq("user_id", userId)
    .eq("hub_id", hubId)
    .maybeSingle();
  if (!uh) {
    throw new Error("No tenés acceso a este hub.");
  }
}

async function registrarEjecucion(params: {
  agente: string;
  hub_id: string | null;
  ejecutado_por: string;
  resultado: { hallazgos: Hallazgo[]; urgencia: Urgencia } | null;
  error?: string;
  duracion_ms: number;
}) {
  const { error } = await supabaseAdmin.from("agente_ejecuciones").insert({
    agente: params.agente,
    hub_id: params.hub_id,
    ejecutado_por: params.ejecutado_por,
    exito: params.resultado != null,
    error: params.error ?? null,
    hallazgos: params.resultado?.hallazgos ?? [],
    urgencia: params.resultado?.urgencia ?? null,
    duracion_ms: params.duracion_ms,
  });
  if (error) console.error("[Agentes] No se pudo registrar la ejecución:", error);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const HubIdSchema = z.object({ hub_id: z.string().uuid() });

// ============================================================
// 1. ALERTAS KPIS — CD5/DSR por hub vs. umbrales
// ============================================================
// Umbrales tal cual los diste: CD5 < 95%, DSR < 91%. "DSR bandas" lo
// interpreté como el DSR general del hub (no encontré en el código ninguna
// noción de "bandas" de DSR separada) — avisame si te referías a otra cosa
// (ej. SLA por CP de mapa_cp_data) y lo ajusto.
export const ejecutarAlertasKpis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => HubIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<ResultadoAgente> => {
    await assertAccesoAgente(context.supabase, context.userId, data.hub_id);
    const start = Date.now();
    try {
      const fecha = isoAddDays(toIso(new Date()), -1);
      const hallazgos: Hallazgo[] = [];

      const cd5From = isoAddDays(fecha, -5 - 30);
      const cd5Rows = await fetchCd5Rows(supabaseAdmin as any, data.hub_id, cd5From, fecha);
      const cd5 = computeCd5Trend(cd5Rows, [fecha]);
      const cd5Pct = cd5.points[0]?.pct ?? null;
      if (cd5Pct != null && cd5Pct < 95) {
        hallazgos.push({
          titulo: "CD5 por debajo del umbral",
          detalle: `CD5 de ${fecha} fue ${cd5Pct.toFixed(1)}% (umbral 95%).`,
          metrica: "cd5",
          fecha,
          valor: cd5Pct,
          umbral: 95,
        });
      }

      const { data: dsrData, error: dsrErr } = await supabaseAdmin.rpc("dashboard_dsr_stats", {
        _hub_ids: [data.hub_id],
        _include_weekends: true,
        _window_days: 5,
      });
      if (dsrErr) throw dsrErr;
      const dsrTrend = ((dsrData as any)?.trend ?? []) as { fecha: string; delivered: number; failed: number }[];
      const dsrPoint = dsrTrend.find((p) => p.fecha === fecha);
      if (dsrPoint) {
        const total = dsrPoint.delivered + dsrPoint.failed;
        const dsrPct = total > 0 ? (dsrPoint.delivered / total) * 100 : null;
        if (dsrPct != null && dsrPct < 91) {
          hallazgos.push({
            titulo: "DSR por debajo del umbral",
            detalle: `DSR de ${fecha} fue ${dsrPct.toFixed(1)}% (umbral 91%).`,
            metrica: "dsr",
            fecha,
            valor: dsrPct,
            umbral: 91,
          });
        }
      }

      const resultado: ResultadoAgente = {
        agente: "alertas_kpis",
        hub_id: data.hub_id,
        hallazgos,
        urgencia: hallazgos.length > 0 ? "critica" : "informativa",
      };
      await registrarEjecucion({ agente: "alertas_kpis", hub_id: data.hub_id, ejecutado_por: context.userId, resultado, duracion_ms: Date.now() - start });
      return resultado;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      await registrarEjecucion({ agente: "alertas_kpis", hub_id: data.hub_id, ejecutado_por: context.userId, resultado: null, error: msg, duracion_ms: Date.now() - start });
      throw e;
    }
  });

// ============================================================
// 2. DRIVER EN RIESGO — 3+ días con la misma incidencia, o DSR
//    cayendo sostenido, por driver
// ============================================================
// "DSR cayendo sostenido" no tenía una definición numérica en el prompt —
// la implementé como: DSR de los últimos 3 días del driver bajó 15 puntos
// porcentuales o más contra los 3 días anteriores. Es una interpretación
// mía, no algo confirmado — el umbral (15pp) y la ventana (3+3 días) están
// en constantes fáciles de mover si preferís otro criterio.
const DSR_CAIDA_UMBRAL_PP = 15;
const INCIDENCIA_DIAS_UMBRAL = 3;

export const ejecutarDriverRiesgo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => HubIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<ResultadoAgente> => {
    await assertAccesoAgente(context.supabase, context.userId, data.hub_id);
    const start = Date.now();
    try {
      const hoy = toIso(new Date());
      const desde = isoAddDays(hoy, -13); // 3+3 días de ventana + margen
      const { data: rows, error } = await supabaseAdmin
        .from("epod_lineas")
        .select("driver, fecha, estado, exception_detail")
        .eq("hub_id", data.hub_id)
        .gte("fecha", desde)
        .lte("fecha", hoy);
      if (error) throw error;

      type Row = { driver: string | null; fecha: string | null; estado: string; exception_detail: string | null };
      const porDriver = new Map<string, Row[]>();
      for (const r of (rows ?? []) as Row[]) {
        const driver = (r.driver ?? "").split(" | ")[0].trim();
        if (!driver || !r.fecha) continue;
        if (!porDriver.has(driver)) porDriver.set(driver, []);
        porDriver.get(driver)!.push(r);
      }

      const hallazgos: Hallazgo[] = [];
      for (const [driver, driverRows] of porDriver) {
        // Misma incidencia (exception_detail) en 3+ días distintos.
        const diasPorIncidencia = new Map<string, Set<string>>();
        for (const r of driverRows) {
          const detalle = (r.exception_detail ?? "").trim();
          if (!detalle) continue;
          if (!diasPorIncidencia.has(detalle)) diasPorIncidencia.set(detalle, new Set());
          diasPorIncidencia.get(detalle)!.add(r.fecha as string);
        }
        for (const [detalle, dias] of diasPorIncidencia) {
          if (dias.size >= INCIDENCIA_DIAS_UMBRAL) {
            hallazgos.push({
              titulo: `${driver}: misma incidencia repetida`,
              detalle: `"${detalle}" en ${dias.size} días distintos de los últimos 14.`,
              driver,
              tipo: "incidencia_repetida",
              dias: [...dias].sort(),
            });
          }
        }

        // DSR cayendo sostenido: últimos 3 días vs. los 3 anteriores.
        const porFecha = new Map<string, { entregado: number; fallo: number }>();
        for (const r of driverRows) {
          const fecha = r.fecha as string;
          if (!porFecha.has(fecha)) porFecha.set(fecha, { entregado: 0, fallo: 0 });
          const bucket = porFecha.get(fecha)!;
          const estadoNorm = r.estado.trim().toLowerCase();
          if (estadoNorm === "entregado" || estadoNorm === "delivered") bucket.entregado++;
          else if (estadoNorm === "attempt failure") bucket.fallo++;
        }
        const fechasOrdenadas = [...porFecha.keys()].sort();
        if (fechasOrdenadas.length >= 6) {
          const ultimos3 = fechasOrdenadas.slice(-3);
          const previos3 = fechasOrdenadas.slice(-6, -3);
          const dsrDe = (fechas: string[]) => {
            let entregado = 0, fallo = 0;
            for (const f of fechas) { entregado += porFecha.get(f)!.entregado; fallo += porFecha.get(f)!.fallo; }
            const total = entregado + fallo;
            return total > 0 ? (entregado / total) * 100 : null;
          };
          const dsrReciente = dsrDe(ultimos3);
          const dsrPrevio = dsrDe(previos3);
          if (dsrReciente != null && dsrPrevio != null && dsrPrevio - dsrReciente >= DSR_CAIDA_UMBRAL_PP) {
            hallazgos.push({
              titulo: `${driver}: DSR cayendo sostenido`,
              detalle: `DSR bajó de ${dsrPrevio.toFixed(1)}% a ${dsrReciente.toFixed(1)}% (últimos 3 días vs. 3 anteriores).`,
              driver,
              tipo: "dsr_cayendo",
              dsr_previo: dsrPrevio,
              dsr_reciente: dsrReciente,
            });
          }
        }
      }

      const resultado: ResultadoAgente = {
        agente: "driver_riesgo",
        hub_id: data.hub_id,
        hallazgos,
        urgencia: hallazgos.length > 0 ? "critica" : "informativa",
      };
      await registrarEjecucion({ agente: "driver_riesgo", hub_id: data.hub_id, ejecutado_por: context.userId, resultado, duracion_ms: Date.now() - start });
      return resultado;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      await registrarEjecucion({ agente: "driver_riesgo", hub_id: data.hub_id, ejecutado_por: context.userId, resultado: null, error: msg, duracion_ms: Date.now() - start });
      throw e;
    }
  });

// ============================================================
// 3. CLASIFICADOR RECLAMACIONES — Categoría A (reparto) / B (producto)
// ============================================================
// tipo ya es un enum fijo en el formulario de Reclamaciones — mapea directo
// a A/B salvo "Otro", donde uso palabras clave sobre comentarios como
// respaldo (roto/dañado/defectuoso → B, si no matchea nada cae en A por
// default ya que la mayoría de reclamaciones son de reparto). Es una
// heurística simple, no un modelo — así se pidió ("sin decidir nada por su
// cuenta").
const TIPOS_CATEGORIA_B = new Set(["Paquete dañado"]);
const PALABRAS_CATEGORIA_B = ["roto", "dañado", "defectuoso", "mal estado", "golpeado"];

export const ejecutarClasificadorReclamaciones = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => HubIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<ResultadoAgente> => {
    await assertAccesoAgente(context.supabase, context.userId, data.hub_id);
    const start = Date.now();
    try {
      const hoy = toIso(new Date());
      const { data: rows, error } = await supabaseAdmin
        .from("reclamaciones")
        .select("ref, tipo, comentarios, created_at")
        .eq("hub_id", data.hub_id)
        .gte("created_at", `${hoy}T00:00:00Z`);
      if (error) throw error;

      const hallazgos: Hallazgo[] = ((rows ?? []) as { ref: string; tipo: string; comentarios: string | null; created_at: string }[]).map((r) => {
        let categoria: "A" | "B";
        if (TIPOS_CATEGORIA_B.has(r.tipo)) categoria = "B";
        else if (r.tipo === "Otro") {
          const texto = (r.comentarios ?? "").toLowerCase();
          categoria = PALABRAS_CATEGORIA_B.some((p) => texto.includes(p)) ? "B" : "A";
        } else {
          categoria = "A";
        }
        return {
          titulo: `${r.ref}: Categoría ${categoria}`,
          detalle: `Tipo "${r.tipo}" clasificado como ${categoria === "A" ? "reparto" : "producto"}.`,
          ref: r.ref,
          tipo: r.tipo,
          categoria,
        };
      });

      const resultado: ResultadoAgente = {
        agente: "clasificador_reclamaciones",
        hub_id: data.hub_id,
        hallazgos,
        urgencia: "informativa",
      };
      await registrarEjecucion({ agente: "clasificador_reclamaciones", hub_id: data.hub_id, ejecutado_por: context.userId, resultado, duracion_ms: Date.now() - start });
      return resultado;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      await registrarEjecucion({ agente: "clasificador_reclamaciones", hub_id: data.hub_id, ejecutado_por: context.userId, resultado: null, error: msg, duracion_ms: Date.now() - start });
      throw e;
    }
  });

// ============================================================
// 4. RESUMEN EJECUTIVO — semana actual vs. semana anterior, por hub
// ============================================================
// Alcance de esta primera versión: entregas totales, DSR promedio, y
// reclamaciones nuevas. CD5 semanal queda FUERA de este agente por ahora —
// requeriría re-correr el cohorte día por día de toda la semana, que es más
// pesado; si lo querés incluido lo sumo en una siguiente pasada.
export const ejecutarResumenEjecutivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => HubIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<ResultadoAgente> => {
    await assertAccesoAgente(context.supabase, context.userId, data.hub_id);
    const start = Date.now();
    try {
      const hoy = toIso(new Date());
      const semanaActualDesde = isoAddDays(hoy, -6);
      const semanaAnteriorDesde = isoAddDays(hoy, -13);
      const semanaAnteriorHasta = isoAddDays(hoy, -7);

      const contarEntregas = async (desde: string, hasta: string) => {
        const { count, error } = await supabaseAdmin
          .from("entregas")
          .select("id", { count: "exact", head: true })
          .eq("hub_id", data.hub_id)
          .gte("fecha", desde)
          .lte("fecha", hasta);
        if (error) throw error;
        return count ?? 0;
      };
      const contarReclamaciones = async (desde: string, hasta: string) => {
        const { count, error } = await supabaseAdmin
          .from("reclamaciones")
          .select("id", { count: "exact", head: true })
          .eq("hub_id", data.hub_id)
          .gte("created_at", `${desde}T00:00:00Z`)
          .lte("created_at", `${hasta}T23:59:59Z`);
        if (error) throw error;
        return count ?? 0;
      };
      const dsrPromedio = async (desde: string, hasta: string) => {
        const dias = Math.round((new Date(`${hasta}T00:00:00Z`).getTime() - new Date(`${desde}T00:00:00Z`).getTime()) / 86_400_000) + 1;
        const { data: dsrData, error } = await supabaseAdmin.rpc("dashboard_dsr_stats", {
          _hub_ids: [data.hub_id],
          _include_weekends: true,
          _window_days: dias,
        });
        if (error) throw error;
        const trend = ((dsrData as any)?.trend ?? []) as { fecha: string; delivered: number; failed: number }[];
        const enRango = trend.filter((p) => p.fecha >= desde && p.fecha <= hasta);
        const entregado = enRango.reduce((a, p) => a + p.delivered, 0);
        const fallo = enRango.reduce((a, p) => a + p.failed, 0);
        const total = entregado + fallo;
        return total > 0 ? (entregado / total) * 100 : null;
      };

      const [entregasActual, entregasAnterior, reclamacionesActual, reclamacionesAnterior, dsrActual, dsrAnterior] = await Promise.all([
        contarEntregas(semanaActualDesde, hoy),
        contarEntregas(semanaAnteriorDesde, semanaAnteriorHasta),
        contarReclamaciones(semanaActualDesde, hoy),
        contarReclamaciones(semanaAnteriorDesde, semanaAnteriorHasta),
        dsrPromedio(semanaActualDesde, hoy),
        dsrPromedio(semanaAnteriorDesde, semanaAnteriorHasta),
      ]);

      const variacion = (actual: number, anterior: number) => (anterior > 0 ? ((actual - anterior) / anterior) * 100 : null);

      const hallazgos: Hallazgo[] = [
        {
          titulo: "Entregas",
          detalle: `${entregasActual} esta semana vs. ${entregasAnterior} la semana anterior.`,
          metrica: "entregas",
          semana_actual: entregasActual,
          semana_anterior: entregasAnterior,
          variacion_pct: variacion(entregasActual, entregasAnterior),
        },
        {
          titulo: "DSR promedio",
          detalle: `${dsrActual != null ? dsrActual.toFixed(1) + "%" : "sin datos"} esta semana vs. ${dsrAnterior != null ? dsrAnterior.toFixed(1) + "%" : "sin datos"} la anterior.`,
          metrica: "dsr_promedio",
          semana_actual: dsrActual,
          semana_anterior: dsrAnterior,
        },
        {
          titulo: "Reclamaciones nuevas",
          detalle: `${reclamacionesActual} esta semana vs. ${reclamacionesAnterior} la semana anterior.`,
          metrica: "reclamaciones",
          semana_actual: reclamacionesActual,
          semana_anterior: reclamacionesAnterior,
          variacion_pct: variacion(reclamacionesActual, reclamacionesAnterior),
        },
      ];

      const resultado: ResultadoAgente = {
        agente: "resumen_ejecutivo",
        hub_id: data.hub_id,
        hallazgos,
        urgencia: "informativa",
      };
      await registrarEjecucion({ agente: "resumen_ejecutivo", hub_id: data.hub_id, ejecutado_por: context.userId, resultado, duracion_ms: Date.now() - start });
      return resultado;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      await registrarEjecucion({ agente: "resumen_ejecutivo", hub_id: data.hub_id, ejecutado_por: context.userId, resultado: null, error: msg, duracion_ms: Date.now() - start });
      throw e;
    }
  });

// ============================================================
// 5. PRE-CALIFICACIÓN LEADS — nuevos con +24h sin contacto
// ============================================================
const LEAD_SIN_CONTACTO_HORAS = 24;

export const ejecutarPrequalificacionLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => HubIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<ResultadoAgente> => {
    await assertAccesoAgente(context.supabase, context.userId, data.hub_id);
    const start = Date.now();
    try {
      const { data: rows, error } = await supabaseAdmin
        .from("leads_reclutamiento")
        .select("id, nombre, telefono, estado, estado_actualizado_en")
        .eq("hub_id", data.hub_id)
        .eq("estado", "nuevo");
      if (error) throw error;

      const nowMs = Date.now();
      const hallazgos: Hallazgo[] = ((rows ?? []) as { id: string; nombre: string; telefono: string; estado: string; estado_actualizado_en: string }[])
        .map((r) => ({ ...r, horas: (nowMs - new Date(r.estado_actualizado_en).getTime()) / 3_600_000 }))
        .filter((r) => r.horas > LEAD_SIN_CONTACTO_HORAS)
        .map((r) => ({
          titulo: `${r.nombre}: sin contacto hace ${Math.round(r.horas)}h`,
          detalle: `Lead nuevo (${r.telefono}) sin cambio de estado hace más de ${LEAD_SIN_CONTACTO_HORAS}h.`,
          lead_id: r.id,
          nombre: r.nombre,
          telefono: r.telefono,
          horas_sin_contacto: Math.round(r.horas),
        }));

      const resultado: ResultadoAgente = {
        agente: "prequalificacion_leads",
        hub_id: data.hub_id,
        hallazgos,
        urgencia: hallazgos.length > 0 ? "critica" : "informativa",
      };
      await registrarEjecucion({ agente: "prequalificacion_leads", hub_id: data.hub_id, ejecutado_por: context.userId, resultado, duracion_ms: Date.now() - start });
      return resultado;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      await registrarEjecucion({ agente: "prequalificacion_leads", hub_id: data.hub_id, ejecutado_por: context.userId, resultado: null, error: msg, duracion_ms: Date.now() - start });
      throw e;
    }
  });

// ============================================================
// 6. DETECCIÓN FRAUDE PUDO — corre el cálculo de gap >250m ya construido
// ============================================================
export const ejecutarFraudePudo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => HubIdSchema.parse(i))
  .handler(async ({ data, context }): Promise<ResultadoAgente> => {
    await assertAccesoAgente(context.supabase, context.userId, data.hub_id);
    const start = Date.now();
    try {
      const fecha = isoAddDays(toIso(new Date()), -1);
      const lineas = await fetchPudoLineas(supabaseAdmin as any, data.hub_id, fecha);
      const puntos = computePuntos(lineas);

      const hallazgos: Hallazgo[] = [];
      for (const punto of puntos) {
        if (punto.nAlertas === 0) continue;
        for (const paq of punto.paquetes) {
          if (!paq.alerta) continue;
          hallazgos.push({
            titulo: `${punto.key === "sin-punto" ? "Punto sin identificar" : punto.key}: gap de ${Math.round(paq.gap as number)}m`,
            detalle: `Paquete ${paq.waybill ?? paq.lp_no} entregado a ${Math.round(paq.gap as number)}m del punto registrado (umbral ${ALERT_THRESHOLD_M}m).`,
            punto: punto.key,
            direccion: punto.direccion,
            waybill: paq.waybill ?? paq.lp_no,
            gap_metros: Math.round(paq.gap as number),
          });
        }
      }

      const resultado: ResultadoAgente = {
        agente: "fraude_pudo",
        hub_id: data.hub_id,
        hallazgos,
        urgencia: hallazgos.length > 0 ? "critica" : "informativa",
      };
      await registrarEjecucion({ agente: "fraude_pudo", hub_id: data.hub_id, ejecutado_por: context.userId, resultado, duracion_ms: Date.now() - start });
      return resultado;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      await registrarEjecucion({ agente: "fraude_pudo", hub_id: data.hub_id, ejecutado_por: context.userId, resultado: null, error: msg, duracion_ms: Date.now() - start });
      throw e;
    }
  });

// ============================================================
// Historial — para el panel de observabilidad
// ============================================================
const HistorialSchema = z.object({ hub_id: z.string().uuid().optional().nullable() });

export type AgenteEjecucionRow = {
  id: string;
  agente: string;
  hub_id: string | null;
  ejecutado_en: string;
  exito: boolean;
  error: string | null;
  hallazgos: Hallazgo[];
  urgencia: Urgencia | null;
  duracion_ms: number | null;
};

export const listarEjecucionesAgentes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => HistorialSchema.parse(i))
  .handler(async ({ data, context }): Promise<AgenteEjecucionRow[]> => {
    await assertAccesoAgente(context.supabase, context.userId, data.hub_id ?? null);
    let query = supabaseAdmin
      .from("agente_ejecuciones")
      .select("id, agente, hub_id, ejecutado_en, exito, error, hallazgos, urgencia, duracion_ms")
      .order("ejecutado_en", { ascending: false })
      .limit(100);
    if (data.hub_id) query = query.eq("hub_id", data.hub_id);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []) as AgenteEjecucionRow[];
  });
