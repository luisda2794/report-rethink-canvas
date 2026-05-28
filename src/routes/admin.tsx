import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { createUser, listUsersWithRoles, toggleHubActive } from "@/lib/admin.functions";
import { Loader2, Plus, X, Check, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/admin")({
  component: () => (
    <RequireAuth adminOnly>
      <AdminPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [{ title: "Menssajero — Administración" }],
  }),
});

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  hub_id: string | null;
  roles: string[];
};

function AdminPage() {
  const { hubs, refresh } = useAuth();
  const listFn = useServerFn(listUsersWithRoles);
  const createFn = useServerFn(createUser);
  const toggleFn = useServerFn(toggleHubActive);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const u = (await listFn()) as UserRow[];
      setUsers(u);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onToggleHub = async (hub_id: string, activo: boolean) => {
    await toggleFn({ data: { hub_id, activo } });
    await refresh();
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Administración" />

      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-5xl mx-auto">
          <header className="mb-12">
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

          {/* HUBS */}
          <section className="mb-14">
            <h2 className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4">Hubs</h2>
            <div className="border border-hairline rounded-lg overflow-hidden">
              {hubs.map((h, i) => (
                <div
                  key={h.id}
                  className={`flex items-center gap-4 p-4 ${i > 0 ? "border-t border-hairline" : ""}`}
                >
                  <div className="font-playfair italic font-extrabold text-electric text-2xl w-10 leading-none">
                    {h.marca[0]}
                  </div>
                  <div className="flex-1">
                    <div className="font-syne font-bold text-ink">{h.marca}</div>
                    <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase">
                      {h.nombre} · {h.ciudad ?? "—"}
                    </div>
                  </div>
                  <button
                    onClick={() => onToggleHub(h.id, !h.activo)}
                    className={`px-3 py-1.5 text-xs font-syne font-semibold rounded transition-colors ${
                      h.activo
                        ? "bg-success/15 text-success border border-success/30"
                        : "bg-surface-2 text-muted-text border border-hairline"
                    }`}
                  >
                    {h.activo ? "Activo" : "Inactivo"}
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* USERS */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase">Usuarios</h2>
              <button
                onClick={() => setShowForm((s) => !s)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-syne font-semibold bg-ink text-white rounded-md hover:bg-ink/90"
              >
                {showForm ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
                {showForm ? "Cancelar" : "Crear usuario"}
              </button>
            </div>

            {showForm && (
              <CreateUserForm
                hubs={hubs}
                onCreated={async () => {
                  setShowForm(false);
                  await loadUsers();
                }}
                createFn={createFn}
              />
            )}

            <div className="border border-hairline rounded-lg overflow-hidden">
              {loadingUsers ? (
                <div className="p-6 text-center text-muted-text font-mono text-xs">Cargando…</div>
              ) : users.length === 0 ? (
                <div className="p-6 text-center text-muted-text font-mono text-xs">Sin usuarios.</div>
              ) : (
                users.map((u, i) => {
                  const hub = hubs.find((h) => h.id === u.hub_id);
                  return (
                    <div
                      key={u.id}
                      className={`flex items-center gap-4 p-4 ${i > 0 ? "border-t border-hairline" : ""}`}
                    >
                      <div className="size-9 rounded-full bg-ink text-white text-xs font-bold flex items-center justify-center">
                        {(u.full_name || u.email || "?")[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-syne font-bold text-ink truncate">
                          {u.full_name || u.email}
                        </div>
                        <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase truncate">
                          {u.email}
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-muted-text uppercase tracking-widest hidden md:block">
                        {hub?.marca ?? "—"}
                      </div>
                      <div className="flex gap-1">
                        {u.roles.map((r) => (
                          <span
                            key={r}
                            className={`px-2 py-0.5 text-[9px] font-mono tracking-widest border rounded uppercase ${
                              r === "admin"
                                ? "bg-electric/10 text-electric border-electric/30"
                                : "bg-surface-2 text-muted-text border-hairline"
                            }`}
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function CreateUserForm({
  hubs,
  onCreated,
  createFn,
}: {
  hubs: { id: string; marca: string }[];
  onCreated: () => void | Promise<void>;
  createFn: (args: { data: { email: string; password: string; full_name: string; hub_id: string; role: "admin" | "operator" } }) => Promise<unknown>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [hubId, setHubId] = useState(hubs[0]?.id ?? "");
  const [role, setRole] = useState<"admin" | "operator">("operator");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      await createFn({ data: { email: email.trim(), password, full_name: fullName.trim(), hub_id: hubId, role } });
      setOk(true);
      setEmail("");
      setPassword("");
      setFullName("");
      await onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-6 p-5 bg-surface border border-hairline rounded-lg space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Nombre completo">
          <input className={inputCls} required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email">
          <input type="email" className={inputCls} required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Contraseña (mín 8)">
          <input type="password" minLength={8} className={inputCls} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Hub">
          <select className={inputCls} value={hubId} onChange={(e) => setHubId(e.target.value)} required>
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.marca}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rol">
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as "admin" | "operator")}>
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
        </Field>
      </div>
      {err && (
        <div className="px-3 py-2 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs rounded-r flex items-center gap-2">
          <AlertCircle className="size-3.5" /> {err}
        </div>
      )}
      {ok && (
        <div className="px-3 py-2 border-l-2 border-success bg-success/10 text-success font-mono text-xs rounded-r flex items-center gap-2">
          <Check className="size-3.5" /> Usuario creado.
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-electric text-white rounded-md hover:brightness-110 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        Crear usuario
      </button>
    </form>
  );
}

const inputCls =
  "w-full h-10 px-3 bg-background border border-hairline rounded-md text-ink font-syne text-sm focus:outline-none focus:border-electric focus:ring-1 focus:ring-electric";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] text-muted-text tracking-widest uppercase block mb-1.5">{label}</span>
      {children}
    </label>
  );
}
