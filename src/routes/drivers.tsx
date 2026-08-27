import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/drivers")({
  component: () => (
    <RequireAuth path="/drivers">
      <DriversPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Drivers" }] }),
});

type Driver = {
  id: string;
  hub_id: string;
  nombre: string;
};

function DriversPage() {
  const { selectedHub } = useAuth();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNombre, setNewNombre] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const load = async () => {
    if (!selectedHub) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("drivers")
      .select("id, hub_id, nombre")
      .eq("hub_id", selectedHub.id)
      .order("nombre");
    if (error) toast.error(error.message);
    setDrivers((data ?? []) as Driver[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHub?.id]);

  const create = async () => {
    const nombre = newNombre.trim();
    if (!nombre || !selectedHub) return;
    setCreating(true);
    const { error } = await supabase
      .from("drivers")
      .insert({ hub_id: selectedHub.id, nombre });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Driver creado");
      setNewNombre("");
      await load();
    }
    setCreating(false);
  };

  const startEdit = (d: Driver) => {
    setEditingId(d.id);
    setEditingValue(d.nombre);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingValue("");
  };

  const saveEdit = async (id: string) => {
    const nombre = editingValue.trim();
    if (!nombre) return;
    setSavingEdit(true);
    const { error } = await supabase.from("drivers").update({ nombre }).eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Driver actualizado");
      cancelEdit();
      await load();
    }
    setSavingEdit(false);
  };

  const remove = async (d: Driver) => {
    if (!confirm(`¿Eliminar el driver "${d.nombre}"? También se eliminarán sus tarifas por CP.`)) return;
    const { error } = await supabase.from("drivers").delete().eq("id", d.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Driver eliminado");
      await load();
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Drivers" />
      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-4xl mx-auto space-y-8">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Drivers</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Hub:{" "}
              <span className="text-foreground font-medium">
                {selectedHub ? `${selectedHub.marca} · ${selectedHub.nombre}` : "—"}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-text">
              Configura las tarifas por CP de cada driver en{" "}
              <Link to="/borradores" className="text-electric hover:underline">Borradores de factura</Link>.
            </p>
          </header>

          {!selectedHub ? (
            <div className="px-4 py-6 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs rounded-r">
              Selecciona un hub en la barra superior para empezar.
            </div>
          ) : (
            <section className="animate-fade-up">
              <div className="bg-surface border border-hairline rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-2 border-b border-hairline font-mono text-[10px] tracking-widest uppercase text-muted-text">
                        <th className="text-left px-4 py-3">Nombre</th>
                        <th className="px-4 py-3 w-24" />
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr>
                          <td colSpan={2} className="px-4 py-8 text-center text-muted-text font-mono text-xs">
                            Cargando…
                          </td>
                        </tr>
                      ) : drivers.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="px-4 py-8 text-center text-muted-text font-mono text-xs">
                            Sin drivers configurados para este hub
                          </td>
                        </tr>
                      ) : (
                        drivers.map((d) => (
                          <tr key={d.id} className="border-b border-hairline/50 hover:bg-surface-2/40 transition-colors">
                            <td className="px-4 py-2.5">
                              {editingId === d.id ? (
                                <input
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && saveEdit(d.id)}
                                  autoFocus
                                  className="w-full bg-transparent border-b border-electric focus:outline-none text-sm text-ink"
                                />
                              ) : (
                                <span className="text-ink font-medium">{d.nombre}</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex items-center gap-1">
                                {editingId === d.id ? (
                                  <>
                                    <button
                                      onClick={() => saveEdit(d.id)}
                                      disabled={savingEdit}
                                      className="size-7 rounded grid place-items-center text-muted-text hover:text-success hover:bg-success/10 transition-colors"
                                      aria-label="Guardar"
                                    >
                                      {savingEdit ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                                    </button>
                                    <button
                                      onClick={cancelEdit}
                                      className="size-7 rounded grid place-items-center text-muted-text hover:text-ink hover:bg-ink/5 transition-colors"
                                      aria-label="Cancelar"
                                    >
                                      <X className="size-3.5" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => startEdit(d)}
                                      className="size-7 rounded grid place-items-center text-muted-text hover:text-electric hover:bg-electric/10 transition-colors"
                                      aria-label="Editar"
                                    >
                                      <Pencil className="size-3.5" />
                                    </button>
                                    <button
                                      onClick={() => remove(d)}
                                      className="size-7 rounded grid place-items-center text-muted-text hover:text-danger hover:bg-danger/10 transition-colors"
                                      aria-label="Eliminar"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-3 p-4 bg-surface-2/50 border-t border-hairline">
                  <input
                    value={newNombre}
                    onChange={(e) => setNewNombre(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && create()}
                    placeholder="Nombre del driver"
                    className="flex-1 border border-hairline rounded px-3 py-1.5 text-sm bg-background font-mono"
                  />
                  <button
                    onClick={create}
                    disabled={creating || !newNombre.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded font-mono text-xs tracking-widest uppercase hover:bg-electric transition-colors disabled:opacity-50"
                  >
                    {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    Añadir driver
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
