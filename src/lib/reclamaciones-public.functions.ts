import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TIPO_VALUES = [
  "Entrega incorrecta",
  "Paquete dañado",
  "Paquete perdido",
  "Entrega en lugar incorrecto",
  "No entregado al destinatario",
  "Otro",
] as const;

export const getReclamacionByToken = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ token: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("reclamaciones")
      .select(
        "id, ref, waybill, lp_no, driver_nombre, fecha_entrega, tipo, importe, cp, comentarios, estado, respuesta_driver, nombre_driver_resp, evidencia_driver, fecha_respuesta",
      )
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { notFound: true as const };
    return { notFound: false as const, reclamacion: row };
  });

export const respondReclamacionByToken = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z
      .object({
        token: z.string().uuid(),
        tipo: z.enum(TIPO_VALUES),
        descripcion: z.string().min(20).max(2000),
        nombre: z.string().min(1).max(120),
        evidencia_url: z.string().url().max(2000).optional().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const { data: existing, error: fErr } = await supabaseAdmin
      .from("reclamaciones")
      .select("id, estado")
      .eq("token", data.token)
      .maybeSingle();
    if (fErr) throw new Error(fErr.message);
    if (!existing) throw new Error("Reclamación no encontrada");
    if (existing.estado === "respondida_driver" || existing.estado === "resuelta") {
      throw new Error("Esta reclamación ya fue respondida.");
    }
    const respuesta = `[${data.tipo}] ${data.descripcion}`;
    const { error } = await supabaseAdmin
      .from("reclamaciones")
      .update({
        estado: "respondida_driver",
        respuesta_driver: respuesta,
        nombre_driver_resp: data.nombre,
        evidencia_driver: data.evidencia_url ?? null,
        fecha_respuesta: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
