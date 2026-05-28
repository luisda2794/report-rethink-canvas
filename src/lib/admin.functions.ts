import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  full_name: z.string().min(1).max(200),
  hub_id: z.string().uuid(),
  role: z.enum(["admin", "operator"]),
});

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Verify caller is admin
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Solo admins pueden crear usuarios.");

    // Create user via admin API (auto-confirms)
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        hub_id: data.hub_id,
        role: data.role,
      },
    });
    if (error || !created.user) throw new Error(error?.message ?? "No se pudo crear el usuario");

    // The trigger creates profile + operator role. If admin requested, also ensure profile hub/name set
    // and role is correct (in case trigger raced).
    await supabaseAdmin
      .from("profiles")
      .upsert({ id: created.user.id, full_name: data.full_name, hub_id: data.hub_id });

    if (data.role === "admin") {
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: created.user.id, role: "admin" }, { onConflict: "user_id,role" });
    }

    return { id: created.user.id };
  });

export const toggleHubActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ hub_id: z.string().uuid(), activo: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("hubs")
      .update({ activo: data.activo })
      .eq("id", data.hub_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listUsersWithRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Solo admins.");

    const { data: profiles, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, hub_id");
    if (pErr) throw new Error(pErr.message);

    const { data: allRoles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const { data: usersList } = await supabaseAdmin.auth.admin.listUsers();

    const byId = new Map(usersList.users.map((u) => [u.id, u.email ?? ""]));
    const rolesByUser = new Map<string, string[]>();
    for (const r of allRoles ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as string);
      rolesByUser.set(r.user_id, arr);
    }

    return (profiles ?? []).map((p) => ({
      id: p.id,
      email: byId.get(p.id) ?? "",
      full_name: p.full_name,
      hub_id: p.hub_id,
      roles: rolesByUser.get(p.id) ?? [],
    }));
  });
