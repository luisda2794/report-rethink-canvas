import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ROLE_VALUES = ["admin", "manager", "jefe_flota", "contable", "customer"] as const;

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  full_name: z.string().min(1).max(200),
  hub_ids: z.array(z.string().uuid()).min(0).max(50),
  primary_hub_id: z.string().uuid().nullable().optional(),
  role: z.enum(ROLE_VALUES),
});

async function assertAdmin(supabase: ReturnType<typeof Object>, userId: string) {
  // typed properly inside
  const { data: prof } = await (supabase as any)
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (!prof || prof.role !== "admin") throw new Error("Solo admins pueden ejecutar esta acción.");
}

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateUserSchema.parse(input))
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

    // The trigger created a profile with default role; overwrite with the requested role
    // and set the primary hub_id.
    const primaryHub = data.primary_hub_id ?? data.hub_ids[0] ?? null;
    const { error: upErr } = await supabaseAdmin
      .from("profiles")
      .upsert({
        id: userId,
        full_name: data.full_name,
        hub_id: primaryHub,
        role: data.role,
      });
    if (upErr) throw new Error(upErr.message);

    if (data.hub_ids.length > 0) {
      const rows = data.hub_ids.map((hub_id) => ({ user_id: userId, hub_id }));
      const { error: hErr } = await supabaseAdmin
        .from("usuario_hubs")
        .upsert(rows, { onConflict: "user_id,hub_id" });
      if (hErr) throw new Error(hErr.message);
    }

    return { id: userId };
  });

export const toggleHubActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ hub_id: z.string().uuid(), activo: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("hubs")
      .update({ activo: data.activo })
      .eq("id", data.hub_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      nombre: z.string().min(1).max(120),
      marca: z.string().min(1).max(120),
      ciudad: z.string().min(0).max(120).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("hubs")
      .insert({ nombre: data.nombre, marca: data.marca, ciudad: data.ciudad || null })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const listUsersWithHubs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: profiles, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, hub_id, role");
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
      full_name: p.full_name,
      hub_id: p.hub_id,
      role: p.role as string,
      hub_ids: hubsByUser.get(p.id) ?? [],
    }));
  });
