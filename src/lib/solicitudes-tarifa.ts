import { supabase } from "@/integrations/supabase/client";

export type EstadoSolicitud =
  | "pendiente_manager"
  | "pendiente_contable"
  | "pendiente_admin"
  | "aprobado"
  | "rechazado";

export type EtapaRechazo = "manager" | "contable" | "admin";

export type ValoresTarifa = {
  tarifa_to_door?: number | null;
  tarifa_pudo_primero?: number | null;
  tarifa_pudo_extra?: number | null;
  precio_salida?: number | null;
  nota?: string | null;
};

export type SolicitudTarifa = {
  id: string;
  hub_id: string;
  hub_nombre: string;
  driver_id: string;
  driver_nombre: string;
  tipo: "tarifa_normal" | "situacion_especial";
  codigo_postal: string;
  fecha: string | null;
  valores_propuestos: ValoresTarifa;
  valores_anteriores: ValoresTarifa | null;
  solicitado_por: string;
  solicitado_por_nombre: string;
  solicitado_en: string;
  estado: EstadoSolicitud;
  aprobado_manager_por: string | null;
  aprobado_manager_nombre: string | null;
  aprobado_manager_en: string | null;
  aprobado_contable_por: string | null;
  aprobado_contable_nombre: string | null;
  aprobado_contable_en: string | null;
  aprobado_admin_por: string | null;
  aprobado_admin_nombre: string | null;
  aprobado_admin_en: string | null;
  rechazado_por: string | null;
  rechazado_nombre: string | null;
  rechazado_en: string | null;
  rechazado_en_etapa: EtapaRechazo | null;
  motivo_rechazo: string | null;
};

export const ESTADO_LABEL: Record<EstadoSolicitud, string> = {
  pendiente_manager: "Esperando Manager",
  pendiente_contable: "Esperando Jefe Contable",
  pendiente_admin: "Esperando Admin",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
};

export const ESTADO_COLOR: Record<EstadoSolicitud, string> = {
  pendiente_manager: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  pendiente_contable: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  pendiente_admin: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  aprobado: "bg-success/10 text-success border-success/30",
  rechazado: "bg-danger/10 text-danger border-danger/30",
};

export const TIPO_SOLICITUD_LABEL: Record<SolicitudTarifa["tipo"], string> = {
  tarifa_normal: "Tarifa normal",
  situacion_especial: "Situación especial",
};

// Etapa que le corresponde aprobar/rechazar a cada rol — usado tanto para
// filtrar qué panel de /aprobaciones mostrar como para saber qué columnas
// (aprobado_X_por/nombre/en) completar al actuar sobre una solicitud.
export function etapaDeRol(role: string | null | undefined): EtapaRechazo | null {
  if (role === "manager") return "manager";
  if (role === "jefe_contable") return "contable";
  if (role === "admin") return "admin";
  return null;
}

export function estadoPendienteDeEtapa(etapa: EtapaRechazo): EstadoSolicitud {
  if (etapa === "manager") return "pendiente_manager";
  if (etapa === "contable") return "pendiente_contable";
  return "pendiente_admin";
}

// Aprobar: avanza a la siguiente etapa, o a 'aprobado' + aplica el cambio
// real si la que acaba de aprobar es la última (admin).
export async function aprobarSolicitud(
  s: SolicitudTarifa,
  etapa: EtapaRechazo,
  actorId: string,
  actorNombre: string,
): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};

  if (etapa === "manager") {
    patch.aprobado_manager_por = actorId;
    patch.aprobado_manager_nombre = actorNombre;
    patch.aprobado_manager_en = now;
    patch.estado = "pendiente_contable";
  } else if (etapa === "contable") {
    patch.aprobado_contable_por = actorId;
    patch.aprobado_contable_nombre = actorNombre;
    patch.aprobado_contable_en = now;
    patch.estado = "pendiente_admin";
  } else {
    patch.aprobado_admin_por = actorId;
    patch.aprobado_admin_nombre = actorNombre;
    patch.aprobado_admin_en = now;
    patch.estado = "aprobado";
  }

  if (etapa === "admin") {
    const applyResult = await aplicarCambioTarifa(s);
    if (applyResult.error) return applyResult;
  }

  const { error } = await supabase.from("solicitudes_tarifa").update(patch).eq("id", s.id);
  return { error: error?.message ?? null };
}

export async function rechazarSolicitud(
  s: SolicitudTarifa,
  etapa: EtapaRechazo,
  actorId: string,
  actorNombre: string,
  motivo: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("solicitudes_tarifa")
    .update({
      estado: "rechazado",
      rechazado_por: actorId,
      rechazado_nombre: actorNombre,
      rechazado_en: new Date().toISOString(),
      rechazado_en_etapa: etapa,
      motivo_rechazo: motivo,
    })
    .eq("id", s.id);
  return { error: error?.message ?? null };
}

// Se llama solo al aprobar en la etapa admin (la última) — escribe el
// cambio real en driver_tarifas o situaciones_especiales. Corre con la
// sesión del propio admin, que ya tiene bypass total via is_admin() en RLS.
async function aplicarCambioTarifa(s: SolicitudTarifa): Promise<{ error: string | null }> {
  const v = s.valores_propuestos;
  if (s.tipo === "tarifa_normal") {
    const { error } = await supabase.from("driver_tarifas").upsert(
      {
        driver_id: s.driver_id,
        hub_id: s.hub_id,
        codigo_postal: s.codigo_postal,
        precio_door: v.tarifa_to_door ?? 0,
        precio_pudo: v.tarifa_pudo_primero ?? 0,
        precio_aa: v.tarifa_pudo_extra ?? 0,
      },
      { onConflict: "driver_id,codigo_postal" },
    );
    return { error: error?.message ?? null };
  }
  const { error } = await supabase.from("situaciones_especiales").upsert(
    {
      driver_id: s.driver_id,
      hub_id: s.hub_id,
      fecha: s.fecha,
      codigo_postal: s.codigo_postal,
      tarifa_to_door: v.tarifa_to_door ?? null,
      tarifa_pudo_primero: v.tarifa_pudo_primero ?? null,
      tarifa_pudo_extra: v.tarifa_pudo_extra ?? null,
      precio_salida: v.precio_salida ?? null,
      nota: v.nota ?? null,
    },
    { onConflict: "driver_id,fecha,codigo_postal" },
  );
  return { error: error?.message ?? null };
}
