import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Play, Loader2, Check, X, Link2 } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { StatusIndicator } from "@/components/indicator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  listarAgentesHelm,
  listarEjecucionesHelm,
  ejecutarAgenteHelm,
  listarAprobacionesHelm,
  decidirAprobacionHelm,
  listarIntegracionesHelm,
  toggleIntegracionHelm,
  type HelmAgente,
  type HelmCategoria,
  type HelmAgenteEstado,
  type HelmEjecucionRow,
  type HelmEjecucionEstado,
  type HelmAprobacionRow,
  type HelmIntegracion,
} from "@/lib/helm.functions";

export const Route = createFileRoute("/helm")({
  component: () => (
    <RequireAuth adminOnly>
      <HelmPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Helm" }] }),
});

// ============================================================
// Paleta compartida: misma familia de 4 colores que ya usa StatusIndicator
// (emerald/rose/amber/sky), reutilizada acá como pill de texto+fondo suave
// para categoría — no se inventa una paleta nueva.
// ============================================================
const CATEGORIA_LABEL: Record<HelmCategoria, string> = {
  ventas: "Ventas",
  comunicaciones: "Comunicaciones",
  finanzas: "Finanzas",
};

const CATEGORIA_PILL: Record<HelmCategoria, string> = {
  ventas: "bg-rose-500/10 text-rose-600",
  comunicaciones: "bg-sky-500/10 text-sky-600",
  finanzas: "bg-emerald-500/10 text-emerald-600",
};

const ESTADO_AGENTE_COLOR: Record<HelmAgenteEstado, "emerald" | "amber" | "rose"> = {
  activo: "emerald",
  pausado: "amber",
  error: "rose",
};

const ESTADO_AGENTE_LABEL: Record<HelmAgenteEstado, string> = {
  activo: "Activo",
  pausado: "Pausado",
  error: "Error",
};

const ESTADO_EJECUCION_CLASS: Record<HelmEjecucionEstado, string> = {
  exito: "bg-success/10 text-success border-success/30",
  fallo: "bg-danger/10 text-danger border-danger/30",
  ejecutando: "bg-electric/10 text-electric border-electric/30",
};

const ESTADO_EJECUCION_LABEL: Record<HelmEjecucionEstado, string> = {
  exito: "Éxito",
  fallo: "Fallo",
  ejecutando: "Ejecutando",
};

function CategoriaPill({ categoria }: { categoria: HelmCategoria }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${CATEGORIA_PILL[categoria]}`}>
      {CATEGORIA_LABEL[categoria]}
    </span>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface border border-hairline rounded-lg p-4">
      <p className="text-[11px] font-mono uppercase tracking-wide text-muted-text">{label}</p>
      <p className="text-2xl font-semibold text-ink mt-1">{value}</p>
    </div>
  );
}

function isHoy(iso: string): boolean {
  const d = new Date(iso);
  const hoy = new Date();
  return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate();
}

function HelmPage() {
  const listarAgentes = useServerFn(listarAgentesHelm);
  const listarEjecuciones = useServerFn(listarEjecucionesHelm);
  const ejecutarAgente = useServerFn(ejecutarAgenteHelm);
  const listarAprobaciones = useServerFn(listarAprobacionesHelm);
  const decidirAprobacion = useServerFn(decidirAprobacionHelm);
  const listarIntegraciones = useServerFn(listarIntegracionesHelm);
  const toggleIntegracion = useServerFn(toggleIntegracionHelm);

  const [agentes, setAgentes] = useState<HelmAgente[]>([]);
  const [loadingAgentes, setLoadingAgentes] = useState(true);
  const [ejecutando, setEjecutando] = useState<Set<string>>(new Set());

  const [ejecuciones, setEjecuciones] = useState<HelmEjecucionRow[]>([]);
  const [loadingEjecuciones, setLoadingEjecuciones] = useState(true);

  const [pendientes, setPendientes] = useState<HelmAprobacionRow[]>([]);
  const [historico, setHistorico] = useState<HelmAprobacionRow[]>([]);
  const [loadingAprobaciones, setLoadingAprobaciones] = useState(true);
  const [decidiendoId, setDecidiendoId] = useState<string | null>(null);

  const [integraciones, setIntegraciones] = useState<HelmIntegracion[]>([]);
  const [loadingIntegraciones, setLoadingIntegraciones] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadAgentes = async () => {
    setLoadingAgentes(true);
    try {
      setAgentes(await listarAgentes());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error cargando agentes");
    } finally {
      setLoadingAgentes(false);
    }
  };

  const loadEjecuciones = async () => {
    setLoadingEjecuciones(true);
    try {
      setEjecuciones(await listarEjecuciones({ data: {} }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error cargando ejecuciones");
    } finally {
      setLoadingEjecuciones(false);
    }
  };

  const loadAprobaciones = async () => {
    setLoadingAprobaciones(true);
    try {
      const [pend, aprobados, rechazados] = await Promise.all([
        listarAprobaciones({ data: { estado: "pendiente" } }),
        listarAprobaciones({ data: { estado: "aprobado" } }),
        listarAprobaciones({ data: { estado: "rechazado" } }),
      ]);
      setPendientes(pend);
      setHistorico(
        [...aprobados, ...rechazados].sort(
          (a, b) => new Date(b.decidido_en ?? b.solicitado_en).getTime() - new Date(a.decidido_en ?? a.solicitado_en).getTime(),
        ),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error cargando aprobaciones");
    } finally {
      setLoadingAprobaciones(false);
    }
  };

  const loadIntegraciones = async () => {
    setLoadingIntegraciones(true);
    try {
      setIntegraciones(await listarIntegraciones());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error cargando integraciones");
    } finally {
      setLoadingIntegraciones(false);
    }
  };

  useEffect(() => {
    void loadAgentes();
    void loadEjecuciones();
    void loadAprobaciones();
    void loadIntegraciones();
  }, []);

  const runAgente = async (agente: HelmAgente) => {
    setEjecutando((prev) => new Set(prev).add(agente.id));
    try {
      await ejecutarAgente({ data: { agente_id: agente.id } });
      toast.success(`${agente.nombre}: ejecución completada`);
      await Promise.all([loadAgentes(), loadEjecuciones()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error ejecutando el agente");
    } finally {
      setEjecutando((prev) => { const n = new Set(prev); n.delete(agente.id); return n; });
    }
  };

  const decidir = async (aprobacion: HelmAprobacionRow, decision: "aprobado" | "rechazado") => {
    setDecidiendoId(aprobacion.id);
    try {
      await decidirAprobacion({ data: { id: aprobacion.id, decision } });
      toast.success(decision === "aprobado" ? "Acción aprobada" : "Acción rechazada");
      await loadAprobaciones();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al decidir");
    } finally {
      setDecidiendoId(null);
    }
  };

  const toggleIntegracionEstado = async (integracion: HelmIntegracion) => {
    setTogglingId(integracion.id);
    try {
      await toggleIntegracion({ data: { id: integracion.id } });
      await loadIntegraciones();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cambiar la integración");
    } finally {
      setTogglingId(null);
    }
  };

  const stats = useMemo(() => {
    const ejecucionesHoy = ejecuciones.filter((e) => isHoy(e.iniciado_en));
    return {
      agentesActivos: agentes.filter((a) => a.estado === "activo").length,
      ejecucionesHoy: ejecucionesHoy.length,
      tareasHoy: ejecucionesHoy.reduce((s, e) => s + e.tareas_completadas, 0),
      aprobacionesPendientes: pendientes.length,
    };
  }, [agentes, ejecuciones, pendientes]);

  const agentesPorCategoria = useMemo(() => {
    const grupos: Record<HelmCategoria, HelmAgente[]> = { ventas: [], comunicaciones: [], finanzas: [] };
    for (const a of agentes) grupos[a.categoria].push(a);
    return grupos;
  }, [agentes]);

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Helm" />
      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-6xl mx-auto space-y-8">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Helm</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Fase 1: shell de control para agentes de negocio (ventas/comunicaciones/finanzas). Todavía ningún agente llama a un LLM real ni a una integración real — eso llega en una fase posterior.
            </p>
          </header>

          <Tabs defaultValue="dashboard" className="space-y-6">
            <TabsList>
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="ejecuciones">Ejecuciones</TabsTrigger>
              <TabsTrigger value="aprobaciones">Aprobaciones</TabsTrigger>
              <TabsTrigger value="integraciones">Integraciones</TabsTrigger>
            </TabsList>

            {/* ==================== DASHBOARD ==================== */}
            <TabsContent value="dashboard" className="space-y-8">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatChip label="Agentes activos" value={stats.agentesActivos} />
                <StatChip label="Ejecuciones hoy" value={stats.ejecucionesHoy} />
                <StatChip label="Tareas completadas hoy" value={stats.tareasHoy} />
                <StatChip label="Aprobaciones pendientes" value={stats.aprobacionesPendientes} />
              </div>

              {loadingAgentes ? (
                <p className="text-muted-text font-mono text-xs">Cargando agentes…</p>
              ) : (
                (["ventas", "comunicaciones", "finanzas"] as HelmCategoria[]).map((categoria) => (
                  <section key={categoria} className="space-y-3">
                    <h2 className="text-sm font-semibold tracking-tight text-ink flex items-center gap-2">
                      {CATEGORIA_LABEL[categoria]}
                      <CategoriaPill categoria={categoria} />
                    </h2>
                    {agentesPorCategoria[categoria].length === 0 ? (
                      <p className="text-sm text-muted-text">Sin agentes en esta categoría.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {agentesPorCategoria[categoria].map((agente) => {
                          const isRunning = ejecutando.has(agente.id);
                          return (
                            <div key={agente.id} className="bg-surface border border-hairline rounded-lg p-4 space-y-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <StatusIndicator color={ESTADO_AGENTE_COLOR[agente.estado]} pulse={agente.estado === "activo"} />
                                    <p className="text-sm font-semibold text-ink">{agente.nombre}</p>
                                  </div>
                                  <p className="text-xs text-muted-text mt-1">{agente.descripcion}</p>
                                </div>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-muted-text font-mono">
                                <span>{ESTADO_AGENTE_LABEL[agente.estado]}</span>
                                <span>
                                  {agente.ultima_ejecucion_en
                                    ? `Última: ${new Date(agente.ultima_ejecucion_en).toLocaleString("es-ES")}`
                                    : "Sin ejecuciones"}
                                </span>
                              </div>
                              <button
                                onClick={() => void runAgente(agente)}
                                disabled={isRunning}
                                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-ink text-white rounded text-xs font-mono uppercase tracking-wide hover:bg-electric disabled:opacity-50"
                              >
                                {isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                                {isRunning ? "Ejecutando…" : "Ejecutar ahora"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ))
              )}
            </TabsContent>

            {/* ==================== EJECUCIONES ==================== */}
            <TabsContent value="ejecuciones">
              <div className="bg-surface border border-hairline rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-2 border-b border-hairline font-mono text-[10px] tracking-widest uppercase text-muted-text">
                        <th className="text-left px-4 py-3">Agente</th>
                        <th className="text-left px-4 py-3">Categoría</th>
                        <th className="text-left px-4 py-3">Estado</th>
                        <th className="text-left px-4 py-3">Resumen</th>
                        <th className="text-left px-4 py-3">Fecha</th>
                        <th className="text-right px-4 py-3">Tareas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingEjecuciones ? (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-text font-mono text-xs">Cargando…</td></tr>
                      ) : ejecuciones.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-text font-mono text-xs">Sin ejecuciones todavía</td></tr>
                      ) : (
                        ejecuciones.map((e) => (
                          <tr key={e.id} className="border-b border-hairline/50">
                            <td className="px-4 py-2.5 text-ink">{e.agente_nombre}</td>
                            <td className="px-4 py-2.5"><CategoriaPill categoria={e.agente_categoria} /></td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wide ${ESTADO_EJECUCION_CLASS[e.estado]}`}>
                                {ESTADO_EJECUCION_LABEL[e.estado]}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-muted-text max-w-[320px] truncate" title={e.resumen ?? ""}>{e.resumen ?? "—"}</td>
                            <td className="px-4 py-2.5 text-muted-text font-mono text-xs whitespace-nowrap">{new Date(e.iniciado_en).toLocaleString("es-ES")}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-ink">{e.tareas_completadas}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            {/* ==================== APROBACIONES ==================== */}
            <TabsContent value="aprobaciones" className="space-y-10">
              <section className="space-y-3">
                <h2 className="text-xs font-mono uppercase tracking-widest text-muted-text">
                  Pendientes ({pendientes.length})
                </h2>
                {loadingAprobaciones ? (
                  <p className="text-muted-text font-mono text-xs">Cargando…</p>
                ) : pendientes.length === 0 ? (
                  <p className="text-sm text-muted-text">No hay aprobaciones pendientes.</p>
                ) : (
                  <div className="space-y-3">
                    {pendientes.map((a) => (
                      <div key={a.id} className="bg-surface border border-hairline rounded-lg p-4 space-y-3">
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div>
                            <p className="text-sm font-semibold text-ink">
                              {a.agente_nombre} <span className="text-muted-text font-normal">· <CategoriaPill categoria={a.agente_categoria} /></span>
                            </p>
                            <p className="text-xs text-muted-text mt-1.5">{a.descripcion_accion}</p>
                            <p className="text-[11px] text-muted-text mt-1 font-mono">
                              Solicitado {new Date(a.solicitado_en).toLocaleString("es-ES")}
                            </p>
                          </div>
                        </div>
                        <div className="pt-2 border-t border-hairline/60 flex items-center gap-2 justify-end">
                          <button
                            onClick={() => void decidir(a, "rechazado")}
                            disabled={decidiendoId === a.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-danger/40 text-danger rounded text-xs font-mono uppercase tracking-wide hover:bg-danger/10 disabled:opacity-50"
                          >
                            {decidiendoId === a.id ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                            Rechazar
                          </button>
                          <button
                            onClick={() => void decidir(a, "aprobado")}
                            disabled={decidiendoId === a.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink text-white rounded text-xs font-mono uppercase tracking-wide hover:bg-electric disabled:opacity-50"
                          >
                            {decidiendoId === a.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                            Aprobar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h2 className="text-xs font-mono uppercase tracking-widest text-muted-text">
                  Histórico
                </h2>
                {loadingAprobaciones ? (
                  <p className="text-muted-text font-mono text-xs">Cargando…</p>
                ) : historico.length === 0 ? (
                  <p className="text-sm text-muted-text">Sin decisiones todavía.</p>
                ) : (
                  <div className="space-y-3 opacity-80">
                    {historico.map((a) => (
                      <div key={a.id} className="bg-surface border border-hairline rounded-lg p-4 space-y-2">
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div>
                            <p className="text-sm font-semibold text-ink">
                              {a.agente_nombre} <span className="text-muted-text font-normal">· <CategoriaPill categoria={a.agente_categoria} /></span>
                            </p>
                            <p className="text-xs text-muted-text mt-1.5">{a.descripcion_accion}</p>
                          </div>
                          <span className={`shrink-0 px-2 py-1 rounded border text-[10px] font-mono uppercase tracking-wide ${
                            a.estado === "aprobado" ? "bg-success/10 text-success border-success/30" : "bg-danger/10 text-danger border-danger/30"
                          }`}>
                            {a.estado === "aprobado" ? "Aprobado" : "Rechazado"}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-text font-mono">
                          Decidido {a.decidido_en ? new Date(a.decidido_en).toLocaleString("es-ES") : "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </TabsContent>

            {/* ==================== INTEGRACIONES ==================== */}
            <TabsContent value="integraciones" className="space-y-8">
              {loadingIntegraciones ? (
                <p className="text-muted-text font-mono text-xs">Cargando…</p>
              ) : (
                (["ventas", "comunicaciones", "finanzas", "general"] as (HelmCategoria | "general")[]).map((categoria) => {
                  const items = integraciones.filter((i) => i.categoria === categoria);
                  if (items.length === 0) return null;
                  return (
                    <section key={categoria} className="space-y-3">
                      <h2 className="text-sm font-semibold tracking-tight text-ink">
                        {categoria === "general" ? "General" : CATEGORIA_LABEL[categoria]}
                      </h2>
                      <div className="bg-surface border border-hairline rounded-lg divide-y divide-hairline/60">
                        {items.map((integracion) => (
                          <div key={integracion.id} className="flex items-center justify-between gap-4 p-4">
                            <div className="flex items-center gap-2">
                              <Link2 className="size-4 text-muted-text" />
                              <span className="text-sm text-ink">{integracion.nombre}</span>
                            </div>
                            <button
                              onClick={() => void toggleIntegracionEstado(integracion)}
                              disabled={togglingId === integracion.id}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono uppercase tracking-wide border disabled:opacity-50 ${
                                integracion.estado === "conectado"
                                  ? "border-success/40 text-success hover:bg-success/10"
                                  : "border-hairline text-muted-text hover:bg-surface-2"
                              }`}
                            >
                              {togglingId === integracion.id && <Loader2 className="size-3.5 animate-spin" />}
                              {integracion.estado === "conectado" ? "Conectado" : "Desconectado"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
