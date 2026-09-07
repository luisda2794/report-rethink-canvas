import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Clock } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { StatusIndicator } from "@/components/indicator";

export const Route = createFileRoute("/leads")({
  component: () => (
    <RequireAuth path="/leads">
      <LeadsPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Leads" }] }),
});

type Estado = "nuevo" | "contactado" | "entrevistado" | "contratado" | "descartado";
type Fuente = "instagram" | "tiktok" | "milanuncios" | "referido" | "otro";

type Lead = {
  id: string;
  nombre: string;
  telefono: string;
  codigo_postal: string | null;
  hub_id: string | null;
  fuente: Fuente;
  estado: Estado;
  notas: string | null;
  proxima_llamada: string | null;
  creado_en: string;
  actualizado_en: string;
  estado_actualizado_en: string;
};

type HubOption = { id: string; nombre: string; marca: string };

const ESTADOS: Estado[] = ["nuevo", "contactado", "entrevistado", "contratado", "descartado"];
const FUENTES: Fuente[] = ["instagram", "tiktok", "milanuncios", "referido", "otro"];
const TERMINAL_ESTADOS: Estado[] = ["contratado", "descartado"];
const STALE_HOURS = 48;

const ESTADO_LABEL: Record<Estado, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  entrevistado: "Entrevistado",
  contratado: "Contratado",
  descartado: "Descartado",
};

const ESTADO_COLOR: Record<Estado, string> = {
  nuevo: "bg-electric/10 text-electric border-electric/30",
  contactado: "bg-amber-400/15 text-amber-700 dark:text-amber-400 border-amber-400/40",
  entrevistado: "bg-amber-500/15 text-amber-700 border-amber-500/40",
  contratado: "bg-success/15 text-success border-success/30",
  descartado: "bg-destructive/10 text-destructive border-destructive/30",
};

const FUENTE_LABEL: Record<Fuente, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  milanuncios: "Milanuncios",
  referido: "Referido",
  otro: "Otro",
};

function isStale(lead: Lead, nowMs: number): boolean {
  if (TERMINAL_ESTADOS.includes(lead.estado)) return false;
  const hours = (nowMs - new Date(lead.estado_actualizado_en).getTime()) / 3_600_000;
  return hours > STALE_HOURS;
}

function LeadsPage() {
  const { role, hubs: authHubs } = useAuth();
  const esAdminOManager = role === "admin" || role === "manager";

  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [hubFilter, setHubFilter] = useState<string>("todos"); // "todos" | "sin-asignar" | hub_id
  const [estadoFilter, setEstadoFilter] = useState<"todos" | Estado>("todos");
  const [fuenteFilter, setFuenteFilter] = useState<"todas" | Fuente>("todas");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!esAdminOManager) return;
    supabase
      .from("hubs")
      .select("id, nombre, marca")
      .order("marca")
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setHubs((data ?? []) as HubOption[]);
      });
  }, [esAdminOManager]);

  const load = async () => {
    setLoading(true);
    let query = supabase.from("leads_reclutamiento").select("*").order("creado_en", { ascending: false });
    if (esAdminOManager) {
      if (hubFilter === "sin-asignar") query = query.is("hub_id", null);
      else if (hubFilter !== "todos") query = query.eq("hub_id", hubFilter);
    }
    if (estadoFilter !== "todos") query = query.eq("estado", estadoFilter);
    if (fuenteFilter !== "todas") query = query.eq("fuente", fuenteFilter);
    const { data, error } = await query;
    if (error) toast.error(error.message);
    setLeads((data ?? []) as Lead[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esAdminOManager, hubFilter, estadoFilter, fuenteFilter]);

  const counts = ESTADOS.reduce(
    (acc, e) => ({ ...acc, [e]: leads.filter((l) => l.estado === e).length }),
    {} as Record<Estado, number>,
  );
  const total = leads.length;
  const tasaConversion = total > 0 ? (counts.contratado / total) * 100 : 0;

  const hubNombre = (hubId: string | null) => {
    if (!hubId) return null;
    const h = hubs.find((x) => x.id === hubId) ?? authHubs.find((x) => x.id === hubId);
    return h ? `${h.marca} · ${h.nombre}` : hubId;
  };

  const updateLead = async (id: string, patch: Partial<Pick<Lead, "estado" | "notas" | "proxima_llamada" | "hub_id">>) => {
    const { data, error } = await supabase.from("leads_reclutamiento").update(patch).eq("id", id).select().single();
    if (error) {
      toast.error(error.message);
      return;
    }
    const updated = data as Lead;
    setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
    setSelected((s) => (s && s.id === id ? updated : s));
    toast.success("Lead actualizado");
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Leads" />
      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-6xl mx-auto space-y-8">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reclutamiento de Repartidores</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Leads capturados desde Instagram/TikTok Ads y Milanuncios, asignados automáticamente por código postal.
            </p>
          </header>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="shadow-none">
              <CardContent className="py-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
                <p className="font-semibold text-2xl tabular-nums mt-1">{total}</p>
              </CardContent>
            </Card>
            <Card className="shadow-none">
              <CardContent className="py-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Nuevos</p>
                <p className="font-semibold text-2xl tabular-nums mt-1">{counts.nuevo}</p>
              </CardContent>
            </Card>
            <Card className="shadow-none">
              <CardContent className="py-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Contratados</p>
                <p className="font-semibold text-2xl tabular-nums mt-1">{counts.contratado}</p>
              </CardContent>
            </Card>
            <Card className="shadow-none">
              <CardContent className="py-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tasa de conversión</p>
                <p className="font-semibold text-2xl tabular-nums mt-1">{tasaConversion.toFixed(1)}%</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {esAdminOManager && (
              <label className="block">
                <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Hub</span>
                <select
                  value={hubFilter}
                  onChange={(e) => setHubFilter(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 text-sm bg-card border rounded-md text-foreground min-w-[200px]"
                >
                  <option value="todos">Todos los hubs</option>
                  <option value="sin-asignar">Sin asignar</option>
                  {hubs.map((h) => (
                    <option key={h.id} value={h.id}>{h.marca} · {h.nombre}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Estado</span>
              <select
                value={estadoFilter}
                onChange={(e) => setEstadoFilter(e.target.value as typeof estadoFilter)}
                className="appearance-none pl-3 pr-8 py-2 text-sm bg-card border rounded-md text-foreground"
              >
                <option value="todos">Todos</option>
                {ESTADOS.map((e) => <option key={e} value={e}>{ESTADO_LABEL[e]}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Fuente</span>
              <select
                value={fuenteFilter}
                onChange={(e) => setFuenteFilter(e.target.value as typeof fuenteFilter)}
                className="appearance-none pl-3 pr-8 py-2 text-sm bg-card border rounded-md text-foreground"
              >
                <option value="todas">Todas</option>
                {FUENTES.map((f) => <option key={f} value={f}>{FUENTE_LABEL[f]}</option>)}
              </select>
            </label>
          </div>

          <Card className="shadow-none overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted">
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Nombre</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Teléfono</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">CP</th>
                      {esAdminOManager && <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Hub</th>}
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Fuente</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Estado</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Próxima llamada</th>
                      <th className="px-4 py-2.5 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-xs">Cargando…</td></tr>
                    ) : leads.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-xs">Sin leads para este filtro</td></tr>
                    ) : (
                      leads.map((l) => {
                        const stale = isStale(l, nowMs);
                        return (
                          <tr
                            key={l.id}
                            onClick={() => setSelected(l)}
                            className={`border-t border-border cursor-pointer hover:bg-accent/40 transition-colors ${stale ? "bg-destructive/5" : ""}`}
                          >
                            <td className="px-4 py-2 text-foreground font-medium whitespace-nowrap">{l.nombre}</td>
                            <td className="px-4 py-2 text-foreground whitespace-nowrap">{l.telefono}</td>
                            <td className="px-4 py-2 text-foreground">{l.codigo_postal ?? "—"}</td>
                            {esAdminOManager && (
                              <td className="px-4 py-2 text-foreground whitespace-nowrap">
                                {hubNombre(l.hub_id) ?? <span className="text-amber-600">Sin asignar</span>}
                              </td>
                            )}
                            <td className="px-4 py-2 text-muted-foreground">{FUENTE_LABEL[l.fuente]}</td>
                            <td className="px-4 py-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] uppercase tracking-wide ${ESTADO_COLOR[l.estado]}`}>
                                {ESTADO_LABEL[l.estado]}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{l.proxima_llamada ?? "—"}</td>
                            <td className="px-4 py-2">
                              {stale && (
                                <span title={`Sin cambio de estado hace más de ${STALE_HOURS}h`}>
                                  <StatusIndicator color="rose" pulse />
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {selected && (
        <LeadDetail
          lead={selected}
          hubs={hubs}
          esAdminOManager={esAdminOManager}
          onClose={() => setSelected(null)}
          onSave={(patch) => void updateLead(selected.id, patch)}
        />
      )}
    </div>
  );
}

function LeadDetail({
  lead,
  hubs,
  esAdminOManager,
  onClose,
  onSave,
}: {
  lead: Lead;
  hubs: HubOption[];
  esAdminOManager: boolean;
  onClose: () => void;
  onSave: (patch: Partial<Pick<Lead, "estado" | "notas" | "proxima_llamada" | "hub_id">>) => void;
}) {
  const [notas, setNotas] = useState(lead.notas ?? "");

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40 animate-fade-in" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full sm:w-[440px] bg-background border-l z-50 overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 bg-background border-b px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Lead</div>
            <div className="text-lg font-semibold text-foreground">{lead.nombre}</div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="p-6 space-y-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Teléfono</dt>
              <dd className="text-sm text-foreground">{lead.telefono}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">CP</dt>
              <dd className="text-sm text-foreground">{lead.codigo_postal ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Fuente</dt>
              <dd className="text-sm text-foreground">{FUENTE_LABEL[lead.fuente]}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Recibido</dt>
              <dd className="text-sm text-foreground">{new Date(lead.creado_en).toLocaleString("es-ES")}</dd>
            </div>
          </dl>

          {esAdminOManager && (
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Hub asignado</span>
              <select
                value={lead.hub_id ?? ""}
                onChange={(e) => onSave({ hub_id: e.target.value || null })}
                className="w-full appearance-none pl-3 pr-8 py-2 text-sm bg-card border rounded-md text-foreground"
              >
                <option value="">— Sin asignar —</option>
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>{h.marca} · {h.nombre}</option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Estado</span>
            <select
              value={lead.estado}
              onChange={(e) => onSave({ estado: e.target.value as Estado })}
              className="w-full appearance-none pl-3 pr-8 py-2 text-sm bg-card border rounded-md text-foreground"
            >
              {ESTADOS.map((e) => <option key={e} value={e}>{ESTADO_LABEL[e]}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Clock className="size-3" /> Próxima llamada
            </span>
            <Input
              type="date"
              value={lead.proxima_llamada ?? ""}
              onChange={(e) => onSave({ proxima_llamada: e.target.value || null })}
            />
          </label>

          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Notas</span>
            <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={4} />
            <Button size="sm" variant="outline" className="mt-2" onClick={() => onSave({ notas: notas.trim() || null })}>
              Guardar notas
            </Button>
          </label>
        </div>
      </aside>
    </>
  );
}
