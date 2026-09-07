import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Formulario público de Reclutamiento (Vía B — Milanuncios, o cualquier
// link compartido directo). Corre con la service role, igual que el
// endpoint público de respuesta de Reclamaciones — no hace falta una
// policy de INSERT anónima en la tabla, y esto además nos deja validar el
// consentimiento RGPD server-side antes de escribir nada.
const SubmitLeadSchema = z.object({
  nombre: z.string().min(1).max(200),
  telefono: z.string().min(6).max(30),
  codigo_postal: z.string().max(10).optional().nullable(),
  consentimiento: z.literal(true),
});

export const submitLeadReclutamiento = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => SubmitLeadSchema.parse(i))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("leads_reclutamiento").insert({
      nombre: data.nombre.trim(),
      telefono: data.telefono.trim(),
      codigo_postal: data.codigo_postal?.trim() || null,
      fuente: "milanuncios",
      raw: {
        origen: "formulario_publico",
        consentimiento_en: new Date().toISOString(),
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
