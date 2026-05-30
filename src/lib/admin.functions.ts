import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ROLE_VALUES = ["admin", "manager", "jefe_flota", "contable", "customer"] as const;

const CreateUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(72),
  full_name: z.string().min(1).max(200),
  hub_ids: z.array(z.string().uuid()).min(1).max(50),
  primary_hub_id: z.string().uuid().nullable().optional(),
  role: z.enum(ROLE_VALUES),
});

const UpdateUserSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().min(1).max(200),
  role: z.enum(ROLE_VALUES),
  hub_ids: z.array(z.string().uuid()).min(1).max(50),
  activo: z.boolean(),
});

const CreateHubSchema = z.object({
  nombre: z.string().min(1).max(120),
  marca: z.string().min(1).max(120),
  ciudad: z.string().min(0).max(120).optional(),
});

const UpdateHubSchema = z.object({
  hub_id: z.string().uuid(),
  nombre: z.string().min(1).max(120),
  marca: z.string().min(1).max(120),
  ciudad: z.string().min(0).max(120).nullable().optional(),
});

type SBClient = {
  from: (t: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: { role?: string } | null }> };
    };
  };
};

async function assertAdmin(supabase: unknown, userId: string) {
  const { data } = await (supabase as SBClient)
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (!data || data.role !== "admin") {
    throw new Error("Solo administradores pueden ejecutar esta acción.");
  }
}

// ─── HUBS ────────────────────────────────────────────────────────────────

export const createHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateHubSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("hubs")
      .insert({ nombre: data.nombre, marca: data.marca, ciudad: data.ciudad || null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const updateHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateHubSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await supabaseAdmin
      .from("hubs")
      .update({ nombre: data.nombre, marca: data.marca, ciudad: data.ciudad || null })
      .eq("id", data.hub_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleHubActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ hub_id: z.string().uuid(), activo: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await supabaseAdmin.from("hubs").update({ activo: data.activo }).eq("id", data.hub_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ hub_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { count, error: cErr } = await supabaseAdmin
      .from("usuario_hubs")
      .select("*", { count: "exact", head: true })
      .eq("hub_id", data.hub_id);
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) {
      throw new Error("No se puede eliminar: el hub tiene usuarios asignados.");
    }
    const { error } = await supabaseAdmin.from("hubs").delete().eq("id", data.hub_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── USERS ───────────────────────────────────────────────────────────────

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateUserSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error || !created.user) throw new Error(error?.message ?? "No se pudo crear el usuario");

    const userId = created.user.id;
    const primaryHub = data.primary_hub_id ?? data.hub_ids[0] ?? null;

    const { error: upErr } = await supabaseAdmin.from("profiles").upsert({
      id: userId,
      full_name: data.full_name,
      hub_id: primaryHub,
      role: data.role,
      activo: true,
    });
    if (upErr) throw new Error(upErr.message);

    const rows = data.hub_ids.map((hub_id) => ({ user_id: userId, hub_id }));
    const { error: hErr } = await supabaseAdmin
      .from("usuario_hubs")
      .upsert(rows, { onConflict: "user_id,hub_id" });
    if (hErr) throw new Error(hErr.message);

    return { id: userId };
  });

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateUserSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    // Self-protection: admin cannot change their own role
    if (data.user_id === context.userId && data.role !== "admin") {
      throw new Error("No puedes cambiar tu propio rol de admin.");
    }

    const primaryHub = data.hub_ids[0] ?? null;
    const { error: upErr } = await supabaseAdmin
      .from("profiles")
      .update({
        full_name: data.full_name,
        role: data.role,
        hub_id: primaryHub,
        activo: data.activo,
      })
      .eq("id", data.user_id);
    if (upErr) throw new Error(upErr.message);

    // Reset hub assignments
    const { error: delErr } = await supabaseAdmin
      .from("usuario_hubs")
      .delete()
      .eq("user_id", data.user_id);
    if (delErr) throw new Error(delErr.message);

    const rows = data.hub_ids.map((hub_id) => ({ user_id: data.user_id, hub_id }));
    const { error: insErr } = await supabaseAdmin.from("usuario_hubs").insert(rows);
    if (insErr) throw new Error(insErr.message);

    return { ok: true };
  });

export const toggleUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ user_id: z.string().uuid(), activo: z.boolean() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId && !data.activo) {
      throw new Error("No puedes desactivar tu propia cuenta.");
    }
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ activo: data.activo })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ user_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) {
      throw new Error("No puedes eliminar tu propia cuenta.");
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listUsersWithHubs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: profiles, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, hub_id, role, activo, created_at");
    if (pErr) throw new Error(pErr.message);

    const { data: mappings } = await supabaseAdmin
      .from("usuario_hubs")
      .select("user_id, hub_id");

    const { data: usersList } = await supabaseAdmin.auth.admin.listUsers();
    const byId = new Map(usersList.users.map((u) => [u.id, u.email ?? ""]));

    const hubsByUser = new Map<string, string[]>();
    for (const m of mappings ?? []) {
      const arr = hubsByUser.get(m.user_id) ?? [];
      arr.push(m.hub_id);
      hubsByUser.set(m.user_id, arr);
    }

    return (profiles ?? []).map((p) => ({
      id: p.id,
      email: byId.get(p.id) ?? "",
      full_name: p.full_name as string | null,
      hub_id: p.hub_id as string | null,
      role: p.role as string,
      activo: (p.activo as boolean | null) ?? true,
      created_at: p.created_at as string,
      hub_ids: hubsByUser.get(p.id) ?? [],
    }));
  });

export const listHubsWithCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: hubs, error } = await supabaseAdmin
      .from("hubs")
      .select("id, nombre, marca, ciudad, activo, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: mappings } = await supabaseAdmin.from("usuario_hubs").select("hub_id");
    const counts = new Map<string, number>();
    for (const m of mappings ?? []) {
      counts.set(m.hub_id, (counts.get(m.hub_id) ?? 0) + 1);
    }
    return (hubs ?? []).map((h) => ({
      id: h.id as string,
      nombre: h.nombre as string,
      marca: h.marca as string,
      ciudad: (h.ciudad as string | null) ?? null,
      activo: h.activo as boolean,
      created_at: h.created_at as string,
      user_count: counts.get(h.id as string) ?? 0,
    }));
  });
