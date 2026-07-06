import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdminOrManager(supabase: any, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const role = data?.role as string | undefined;
  if (!role || !["admin", "manager"].includes(role)) {
    throw new Error("Solo administradores o managers pueden ejecutar esta acción.");
  }
}

const CreateVersionSchema = z.object({
  nombre: z.string().min(1).max(200),
  geojson_path: z.string().min(1).max(500),
});

const CsvRowSchema = z.object({
  cp: z.string().min(1).max(20),
  dsp: z.string().max(200).optional().nullable(),
  hub: z.string().max(200).optional().nullable(),
  sla_teorico: z.string().max(50).optional().nullable(),
  sla_fijo: z.string().max(50).optional().nullable(),
  volumen: z.coerce.number().nonnegative().optional().nullable(),
});

const BulkUpsertSchema = z.object({
  version_id: z.string().uuid(),
  rows: z.array(CsvRowSchema).max(5000),
});

const VersionIdSchema = z.object({
  version_id: z.string().uuid(),
});

export const listMapaVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: versions, error } = await context.supabase
      .from("mapa_versions")
      .select("id, nombre, geojson_path, activa, creado_por, created_at, updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (versions ?? []).map((v) => v.id as string);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: rows } = await context.supabase
        .from("mapa_cp_data")
        .select("version_id");
      for (const r of rows ?? []) {
        const vid = r.version_id as string;
        counts.set(vid, (counts.get(vid) ?? 0) + 1);
      }
    }

    return (versions ?? []).map((v) => ({
      id: v.id as string,
      nombre: v.nombre as string,
      geojson_path: v.geojson_path as string,
      activa: v.activa as boolean,
      creado_por: v.creado_por as string,
      created_at: v.created_at as string,
      updated_at: v.updated_at as string,
      cp_count: counts.get(v.id as string) ?? 0,
    }));
  });

export const getActiveMapaVersion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: version, error } = await context.supabase
      .from("mapa_versions")
      .select("id, nombre, geojson_path, activa, creado_por, created_at, updated_at")
      .eq("activa", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!version) {
      throw new Error("No hay una versión activa del mapa.");
    }

    const { data: cpData, error: cpErr } = await context.supabase
      .from("mapa_cp_data")
      .select("cp, dsp, hub_id, sla_teorico, sla_fijo, volumen");
    if (cpErr) throw new Error(cpErr.message);

    return {
      version: {
        id: version.id as string,
        nombre: version.nombre as string,
        geojson_path: version.geojson_path as string,
        activa: version.activa as boolean,
        creado_por: version.creado_por as string,
        created_at: version.created_at as string,
        updated_at: version.updated_at as string,
      },
      cpData: (cpData ?? []).map((r) => ({
        cp: r.cp as string,
        dsp: (r.dsp as string | null) ?? null,
        hub_id: (r.hub_id as string | null) ?? null,
        sla_teorico: (r.sla_teorico as string | null) ?? null,
        sla_fijo: (r.sla_fijo as string | null) ?? null,
        volumen: (r.volumen as number | null) ?? null,
      })),
    };
  });

export const createMapaVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateVersionSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrManager(context.supabase, context.userId);

    const { error: deactivateErr } = await supabaseAdmin
      .from("mapa_versions")
      .update({ activa: false })
      .eq("activa", true);
    if (deactivateErr) throw new Error(deactivateErr.message);

    const { data: row, error } = await supabaseAdmin
      .from("mapa_versions")
      .insert({
        nombre: data.nombre,
        geojson_path: data.geojson_path,
        activa: true,
        creado_por: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return { id: row.id as string };
  });

export const activateMapaVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => VersionIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrManager(context.supabase, context.userId);

    const { error: deactivateErr } = await supabaseAdmin
      .from("mapa_versions")
      .update({ activa: false })
      .eq("activa", true);
    if (deactivateErr) throw new Error(deactivateErr.message);

    const { error } = await supabaseAdmin
      .from("mapa_versions")
      .update({ activa: true })
      .eq("id", data.version_id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const deleteMapaVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => VersionIdSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrManager(context.supabase, context.userId);

    const { data: version, error: fetchErr } = await supabaseAdmin
      .from("mapa_versions")
      .select("geojson_path")
      .eq("id", data.version_id)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);

    if (version?.geojson_path) {
      await supabaseAdmin.storage.from("mapas").remove([version.geojson_path as string]);
    }

    const { error } = await supabaseAdmin
      .from("mapa_versions")
      .delete()
      .eq("id", data.version_id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const bulkUpsertCpData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BulkUpsertSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdminOrManager(context.supabase, context.userId);

    const { data: version, error: vErr } = await supabaseAdmin
      .from("mapa_versions")
      .select("id")
      .eq("id", data.version_id)
      .single();
    if (vErr || !version) throw new Error("Versión no encontrada.");

    const { data: hubs } = await supabaseAdmin.from("hubs").select("id, nombre, marca");
    const hubByName = new Map<string, string>();
    for (const h of hubs ?? []) {
      const id = h.id as string;
      hubByName.set(String(h.nombre).toLowerCase().trim(), id);
      hubByName.set(String(h.marca).toLowerCase().trim(), id);
    }

    const rows = data.rows.map((r) => ({
      version_id: data.version_id,
      cp: r.cp.trim(),
      dsp: r.dsp?.trim() ?? null,
      hub_id: r.hub ? hubByName.get(r.hub.toLowerCase().trim()) ?? null : null,
      sla_teorico: r.sla_teorico?.trim() ?? null,
      sla_fijo: r.sla_fijo?.trim() ?? null,
      volumen: r.volumen ?? null,
    }));

    const { error } = await supabaseAdmin
      .from("mapa_cp_data")
      .upsert(rows, { onConflict: "version_id,cp" });
    if (error) throw new Error(error.message);

    return { upserted: rows.length };
  });
