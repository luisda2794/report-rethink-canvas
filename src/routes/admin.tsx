import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import {
  createUser,
  updateUser,
  toggleUserActive,
  deleteUser,
  createHub,
  updateHub,
  toggleHubActive,
  deleteHub,
  listUsersWithHubs,
  listHubsWithCounts,
} from "@/lib/admin.functions";
import { ALL_ROLES, ROLE_LABEL, type Role } from "@/lib/roles";
import {
  Loader2,
  Plus,
  X,
  AlertCircle,
  Pencil,
  Trash2,
  Search,
  Eye,
  EyeOff,
  Check,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  component: () => (
    <RequireAuth adminOnly>
      <AdminPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Administración" }] }),
});

type HubRow = {
  id: string;
  nombre: string;
  marca: string;
  ciudad: string | null;
  activo: boolean;
  user_count: number;
  created_at: string;
};

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  hub_id: string | null;
  role: string;
  activo: boolean;
  hub_ids: string[];
  created_at: string;
};

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Acceso total a todos los módulos y hubs",
  manager: "Dashboard, reportes y reclamaciones. Múltiples hubs",
  jefe_flota: "Dashboard, reportes y reclamaciones. Un solo hub",
  contable: "Solo borradores y facturación. Múltiples hubs",
  customer: "Solo reclamaciones. Múltiples hubs",
};

const ROLE_COLOR: Record<Role, string> = {
  admin: "bg-[#1c1c2e] text-white border-[#1c1c2e]",
  manager: "bg-electric/10 text-electric border-electric/30",
  jefe_flota: "bg-[#1d7a4a]/10 text-[#1d7a4a] border-[#1d7a4a]/30",
  contable: "bg-[#a16207]/10 text-[#a16207] border-[#a16207]/30",
  customer: "bg-[#b91c1c]/10 text-[#b91c1c] border-[#b91c1c]/30",
};

function AdminPage() {
  const { user: currentUser } = useAuth();
  const [tab, setTab] = useState<"hubs" | "users">("hubs");

  const listUsersFn = useServerFn(listUsersWithHubs);
  const listHubsFn = useServerFn(listHubsWithCounts);

  const [hubs, setHubs] = useState<HubRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [h, u] = await Promise.all([
        listHubsFn() as Promise<HubRow[]>,
        listUsersFn() as Promise<UserRow[]>,
      ]);
      setHubs(h);
      setUsers(u);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error cargando datos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Administración" />
      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-6xl mx-auto">
          <header className="mb-10">
            <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4 flex items-center gap-2">
              <span className="size-1 bg-electric rounded-full" /> Panel de administración
            </div>
            <h1 className="text-4xl lg:text-5xl font-syne font-extrabold leading-[0.95] text-ink tracking-tighter uppercase">
              Hubs y{" "}
              <span className="font-playfair italic font-medium text-electric normal-case tracking-normal">
                usuarios
              </span>
            </h1>
          </header>

          <div className="flex items-center gap-1 border-b border-hairline mb-8">
            <TabButton active={tab === "hubs"} onClick={() => setTab("hubs")}>
              Hubs <span className="font-mono text-[10px] text-muted-text">({hubs.length})</span>
            </TabButton>
            <TabButton active={tab === "users"} onClick={() => setTab("users")}>
              Usuarios <span className="font-mono text-[10px] text-muted-text">({users.length})</span>
            </TabButton>
          </div>

          {loading ? (
            <div className="p-16 text-center text-muted-text font-mono text-xs">
              <Loader2 className="size-5 animate-spin inline-block mr-2" /> Cargando…
            </div>
          ) : tab === "hubs" ? (
            <HubsTab hubs={hubs} onChange={refresh} />
          ) : (
            <UsersTab
              users={users}
              hubs={hubs}
              currentUserId={currentUser?.id ?? null}
              onChange={refresh}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── HUBS TAB ────────────────────────────────────────────────────────────

function HubsTab({ hubs, onChange }: { hubs: HubRow[]; onChange: () => Promise<void> }) {
  const [modal, setModal] = useState<{ kind: "create" } | { kind: "edit"; hub: HubRow } | null>(null);
  const toggleFn = useServerFn(toggleHubActive);
  const deleteFn = useServerFn(deleteHub);

  const onToggle = async (h: HubRow) => {
    try {
      await toggleFn({ data: { hub_id: h.id, activo: !h.activo } });
      toast.success(`Hub ${!h.activo ? "activado" : "desactivado"}`);
      await onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const onDelete = async (h: HubRow) => {
    if (h.user_count > 0) {
      toast.error("No se puede eliminar: tiene usuarios asignados.");
      return;
    }
    if (!confirm(`¿Eliminar hub "${h.marca}"?`)) return;
    try {
      await deleteFn({ data: { hub_id: h.id } });
      toast.success("Hub eliminado");
      await onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase">
          {hubs.length} hubs
        </h2>
        <button
          onClick={() => setModal({ kind: "create" })}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-syne font-semibold bg-ink text-white rounded-md hover:bg-ink/90"
        >
          <Plus className="size-3.5" /> Crear hub
        </button>
      </div>

      <div className="border border-hairline rounded-lg overflow-hidden bg-surface">
        {hubs.length === 0 ? (
          <div className="p-8 text-center text-muted-text font-mono text-xs">
            Sin hubs. Crea el primero.
          </div>
        ) : (
          hubs.map((h, i) => (
            <div
              key={h.id}
              className={`flex flex-wrap items-center gap-4 p-4 ${i > 0 ? "border-t border-hairline" : ""}`}
            >
              <div className="font-playfair italic font-extrabold text-electric text-2xl w-10 leading-none">
                {h.marca[0]}
              </div>
              <div className="flex-1 min-w-[180px]">
                <div className="font-syne font-bold text-ink">{h.marca}</div>
                <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase">
                  {h.nombre} · {h.ciudad ?? "—"}
                </div>
              </div>
              <span className="font-mono text-[10px] text-muted-text tracking-widest uppercase">
                {h.user_count} usuario{h.user_count === 1 ? "" : "s"}
              </span>
              <button
                onClick={() => onToggle(h)}
                className={`px-3 py-1.5 text-xs font-syne font-semibold rounded transition-colors ${
                  h.activo
                    ? "bg-success/15 text-success border border-success/30"
                    : "bg-surface-2 text-muted-text border border-hairline"
                }`}
              >
                {h.activo ? "Activo" : "Inactivo"}
              </button>
              <button
                onClick={() => setModal({ kind: "edit", hub: h })}
                className="p-1.5 text-muted-text hover:text-ink"
                aria-label="Editar"
              >
                <Pencil className="size-4" />
              </button>
              <button
                onClick={() => onDelete(h)}
                disabled={h.user_count > 0}
                className="p-1.5 text-muted-text hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Eliminar"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {modal && (
        <HubModal
          mode={modal.kind}
          hub={modal.kind === "edit" ? modal.hub : null}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await onChange();
          }}
        />
      )}
    </section>
  );
}

function HubModal({
  mode,
  hub,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  hub: HubRow | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const createFn = useServerFn(createHub);
  const updateFn = useServerFn(updateHub);
  const [nombre, setNombre] = useState(hub?.nombre ?? "");
  const [marca, setMarca] = useState(hub?.marca ?? "");
  const [ciudad, setCiudad] = useState(hub?.ciudad ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (mode === "create") {
        await createFn({ data: { nombre: nombre.trim(), marca: marca.trim(), ciudad: ciudad.trim() } });
        toast.success("Hub creado");
      } else if (hub) {
        await updateFn({
          data: { hub_id: hub.id, nombre: nombre.trim(), marca: marca.trim(), ciudad: ciudad.trim() },
        });
        toast.success("Hub actualizado");
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title={mode === "create" ? "Crear hub" : "Editar hub"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nombre interno (único)">
          <input className={inputCls} required value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </Field>
        <Field label="Marca">
          <input className={inputCls} required value={marca} onChange={(e) => setMarca(e.target.value)} />
        </Field>
        <Field label="Ciudad (opcional)">
          <input className={inputCls} value={ciudad} onChange={(e) => setCiudad(e.target.value)} />
        </Field>
        {err && <ErrorBanner msg={err} />}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-syne text-muted-text hover:text-ink">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-electric text-white rounded-md hover:brightness-110 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {mode === "create" ? "Crear" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── USERS TAB ───────────────────────────────────────────────────────────

function UsersTab({
  users,
  hubs,
  currentUserId,
  onChange,
}: {
  users: UserRow[];
  hubs: HubRow[];
  currentUserId: string | null;
  onChange: () => Promise<void>;
}) {
  const [modal, setModal] = useState<{ kind: "create" } | { kind: "edit"; user: UserRow } | null>(null);
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterHub, setFilterHub] = useState<string>("all");
  const [search, setSearch] = useState("");
  const toggleFn = useServerFn(toggleUserActive);
  const deleteFn = useServerFn(deleteUser);

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.activo).length;
    const byRole: Record<string, number> = {};
    for (const u of users) byRole[u.role] = (byRole[u.role] ?? 0) + 1;
    return { total, active, byRole };
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (filterRole !== "all" && u.role !== filterRole) return false;
      if (filterHub !== "all" && !u.hub_ids.includes(filterHub)) return false;
      if (q) {
        const hay = `${u.full_name ?? ""} ${u.email}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, filterRole, filterHub, search]);

  const onToggle = async (u: UserRow) => {
    if (u.id === currentUserId && u.activo) {
      toast.error("No puedes desactivar tu propia cuenta.");
      return;
    }
    try {
      await toggleFn({ data: { user_id: u.id, activo: !u.activo } });
      toast.success(`Usuario ${!u.activo ? "activado" : "desactivado"}`);
      await onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const onDelete = async (u: UserRow) => {
    if (u.id === currentUserId) {
      toast.error("No puedes eliminar tu propia cuenta.");
      return;
    }
    if (!confirm(`¿Eliminar usuario "${u.email}"? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteFn({ data: { user_id: u.id } });
      toast.success("Usuario eliminado");
      await onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const hubMarca = (id: string) => hubs.find((h) => h.id === id)?.marca ?? "—";

  return (
    <section>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-3 mb-6">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Activos" value={stats.active} accent="success" />
        {ALL_ROLES.map((r) => (
          <StatCard key={r} label={ROLE_LABEL[r]} value={stats.byRole[r] ?? 0} />
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email…"
            className={`${inputCls} pl-9`}
          />
        </div>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className={`${inputCls} max-w-[180px]`}
        >
          <option value="all">Todos los roles</option>
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
        <select
          value={filterHub}
          onChange={(e) => setFilterHub(e.target.value)}
          className={`${inputCls} max-w-[200px]`}
        >
          <option value="all">Todos los hubs</option>
          {hubs.map((h) => (
            <option key={h.id} value={h.id}>{h.marca}</option>
          ))}
        </select>
        <button
          onClick={() => setModal({ kind: "create" })}
          disabled={hubs.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-syne font-semibold bg-ink text-white rounded-md hover:bg-ink/90 disabled:opacity-50"
        >
          <Plus className="size-3.5" /> Crear usuario
        </button>
      </div>

      {/* List */}
      <div className="border border-hairline rounded-lg overflow-hidden bg-surface">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-text font-mono text-xs">Sin resultados.</div>
        ) : (
          filtered.map((u, i) => (
            <div
              key={u.id}
              className={`flex flex-wrap items-center gap-4 p-4 ${i > 0 ? "border-t border-hairline" : ""} ${
                !u.activo ? "opacity-60" : ""
              }`}
            >
              <div className="size-9 rounded-full bg-ink text-white text-xs font-bold flex items-center justify-center shrink-0">
                {(u.full_name || u.email || "?")[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-[180px]">
                <div className="font-syne font-bold text-ink truncate flex items-center gap-2">
                  {u.full_name || "—"}
                  {u.id === currentUserId && (
                    <span className="font-mono text-[9px] tracking-widest uppercase text-electric">(tú)</span>
                  )}
                </div>
                <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase truncate">
                  {u.email}
                </div>
              </div>
              <span
                className={`px-2 py-0.5 text-[9px] font-mono tracking-widest border rounded uppercase ${
                  ROLE_COLOR[u.role as Role] ?? "bg-surface-2 text-muted-text border-hairline"
                }`}
              >
                {ROLE_LABEL[u.role as Role] ?? u.role}
              </span>
              <div className="flex flex-wrap gap-1 max-w-[200px]">
                {u.hub_ids.slice(0, 3).map((id) => (
                  <span
                    key={id}
                    className="px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest bg-surface-2 text-muted-text border border-hairline rounded"
                  >
                    {hubMarca(id)}
                  </span>
                ))}
                {u.hub_ids.length > 3 && (
                  <span className="font-mono text-[9px] text-muted-text">+{u.hub_ids.length - 3}</span>
                )}
              </div>
              <button
                onClick={() => onToggle(u)}
                className={`px-3 py-1.5 text-xs font-syne font-semibold rounded transition-colors ${
                  u.activo
                    ? "bg-success/15 text-success border border-success/30"
                    : "bg-surface-2 text-muted-text border border-hairline"
                }`}
              >
                {u.activo ? "Activo" : "Inactivo"}
              </button>
              <button
                onClick={() => setModal({ kind: "edit", user: u })}
                className="p-1.5 text-muted-text hover:text-ink"
                aria-label="Editar"
              >
                <Pencil className="size-4" />
              </button>
              <button
                onClick={() => onDelete(u)}
                disabled={u.id === currentUserId}
                className="p-1.5 text-muted-text hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Eliminar"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {modal && (
        <UserModal
          mode={modal.kind}
          user={modal.kind === "edit" ? modal.user : null}
          hubs={hubs}
          currentUserId={currentUserId}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await onChange();
          }}
        />
      )}
    </section>
  );
}

function UserModal({
  mode,
  user,
  hubs,
  currentUserId,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  user: UserRow | null;
  hubs: HubRow[];
  currentUserId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const createFn = useServerFn(createUser);
  const updateFn = useServerFn(updateUser);
  const activeHubs = useMemo(() => hubs.filter((h) => h.activo), [hubs]);
  const firstHubId = activeHubs[0]?.id ?? null;

  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [role, setRole] = useState<Role>((user?.role as Role) ?? "jefe_flota");
  const initialHubs = useMemo(() => {
    if (user) return user.hub_ids;
    return firstHubId ? [firstHubId] : [];
  }, [user, firstHubId]);
  const [hubIds, setHubIds] = useState<string[]>(initialHubs);
  const [activo, setActivo] = useState(user?.activo ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isSelf = user?.id === currentUserId;

  // jefe_flota → only 1 hub
  useEffect(() => {
    if (role === "jefe_flota" && hubIds.length > 1) {
      setHubIds(hubIds.slice(0, 1));
    }
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleHubId = (id: string) => {
    if (role === "jefe_flota") {
      setHubIds([id]);
    } else {
      setHubIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }
  };

  const pwdStrength = useMemo(() => scorePassword(password), [password]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (hubIds.length === 0) {
      setErr("Selecciona al menos un hub.");
      return;
    }
    if (role === "jefe_flota" && hubIds.length !== 1) {
      setErr("jefe_flota solo puede tener 1 hub.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "create") {
        await createFn({
          data: {
            email: email.trim(),
            password,
            full_name: fullName.trim(),
            hub_ids: hubIds,
            primary_hub_id: hubIds[0],
            role,
          },
        });
        toast.success("Usuario creado");
      } else if (user) {
        await updateFn({
          data: {
            user_id: user.id,
            full_name: fullName.trim(),
            role,
            hub_ids: hubIds,
            activo,
          },
        });
        toast.success("Usuario actualizado");
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={mode === "create" ? "Crear usuario" : "Editar usuario"}
      wide
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Nombre completo">
            <input className={inputCls} required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Email">
            <input
              type="email"
              className={inputCls}
              required
              disabled={mode === "edit"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </div>

        {mode === "create" && (
          <Field label="Contraseña (mín 8 caracteres)">
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                minLength={8}
                className={`${inputCls} pr-10`}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPwd((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-text hover:text-ink"
                aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {password && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1 bg-surface-2 rounded overflow-hidden flex gap-0.5">
                  <span className={`flex-1 ${pwdStrength.bars >= 1 ? pwdStrength.color : ""}`} />
                  <span className={`flex-1 ${pwdStrength.bars >= 2 ? pwdStrength.color : ""}`} />
                  <span className={`flex-1 ${pwdStrength.bars >= 3 ? pwdStrength.color : ""}`} />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-text">
                  {pwdStrength.label}
                </span>
              </div>
            )}
          </Field>
        )}

        <Field label="Rol">
          <div className="grid gap-2">
            {ALL_ROLES.map((r) => (
              <label
                key={r}
                className={`flex items-start gap-3 p-3 border rounded-md cursor-pointer transition-colors ${
                  role === r
                    ? "border-electric bg-electric/5"
                    : "border-hairline hover:border-muted-text"
                } ${isSelf && r !== "admin" ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <input
                  type="radio"
                  name="role"
                  value={r}
                  checked={role === r}
                  disabled={isSelf && r !== "admin"}
                  onChange={() => setRole(r)}
                  className="mt-1 accent-electric"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-syne font-semibold text-sm text-ink flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 text-[9px] font-mono tracking-widest border rounded uppercase ${ROLE_COLOR[r]}`}
                    >
                      {ROLE_LABEL[r]}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-text mt-1">
                    {ROLE_DESCRIPTIONS[r]}
                  </div>
                </div>
              </label>
            ))}
          </div>
          {isSelf && (
            <p className="font-mono text-[10px] text-muted-text mt-2">
              No puedes cambiar tu propio rol de admin.
            </p>
          )}
        </Field>

        <Field
          label={`Hubs asignados ${role === "jefe_flota" ? "(solo 1)" : "(uno o más)"}`}
        >
          {activeHubs.length === 0 ? (
            <div className="text-muted-text font-mono text-xs">No hay hubs activos.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {activeHubs.map((h) => {
                const on = hubIds.includes(h.id);
                return (
                  <button
                    type="button"
                    key={h.id}
                    onClick={() => toggleHubId(h.id)}
                    className={`px-3 py-2 text-xs font-syne font-semibold rounded border text-left transition-colors ${
                      on
                        ? "bg-electric/10 text-electric border-electric/40"
                        : "bg-surface-2 text-muted-text border-hairline hover:text-ink"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`size-3 border rounded-sm flex items-center justify-center ${
                        on ? "bg-electric border-electric" : "border-muted-text"
                      }`}>
                        {on && <Check className="size-2.5 text-white" />}
                      </span>
                      {h.marca}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Field>

        {mode === "edit" && (
          <Field label="Estado">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={activo}
                disabled={isSelf}
                onChange={(e) => setActivo(e.target.checked)}
                className="accent-electric"
              />
              <span className="text-sm font-syne text-ink">Usuario activo</span>
            </label>
          </Field>
        )}

        {err && <ErrorBanner msg={err} />}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-hairline">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-syne text-muted-text hover:text-ink">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-electric text-white rounded-md hover:brightness-110 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {mode === "create" ? "Crear usuario" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── SHARED UI ───────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-syne font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2 ${
        active
          ? "border-electric text-ink"
          : "border-transparent text-muted-text hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "success" | "electric";
}) {
  const color =
    accent === "success" ? "text-success" : accent === "electric" ? "text-electric" : "text-ink";
  return (
    <div className="p-3 bg-surface border border-hairline rounded-md">
      <div className="font-mono text-[9px] tracking-widest uppercase text-muted-text">{label}</div>
      <div className={`font-syne font-extrabold text-2xl ${color} leading-none mt-1`}>{value}</div>
    </div>
  );
}

function Modal({
  onClose,
  title,
  children,
  wide,
}: {
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-start md:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} bg-background border border-hairline rounded-lg shadow-xl my-8`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <h3 className="font-syne font-bold text-lg text-ink">{title}</h3>
          <button onClick={onClose} className="p-1 text-muted-text hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="px-3 py-2 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs rounded-r flex items-center gap-2">
      <AlertCircle className="size-3.5" /> {msg}
    </div>
  );
}

const inputCls =
  "w-full h-10 px-3 bg-background border border-hairline rounded-md text-ink font-syne text-sm focus:outline-none focus:border-electric focus:ring-1 focus:ring-electric";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] text-muted-text tracking-widest uppercase block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function scorePassword(p: string): { bars: number; label: string; color: string } {
  if (!p) return { bars: 0, label: "—", color: "" };
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  if (score <= 2) return { bars: 1, label: "Débil", color: "bg-danger" };
  if (score <= 3) return { bars: 2, label: "Media", color: "bg-[#a16207]" };
  return { bars: 3, label: "Fuerte", color: "bg-success" };
}
