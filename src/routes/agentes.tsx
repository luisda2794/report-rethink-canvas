import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Play, Loader2, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/indicator";
import {
  ejecutarAlertasKpis,
  ejecutarDriverRiesgo,
  ejecutarClasificadorReclamaciones,
  ejecutarResumenEjecutivo,
  ejecutarPrequalificacionLeads,
  ejecutarFraudePudo,
  listarEjecucionesAgentes,
  type ResultadoAgente,
  type AgenteEjecucionRow,
} from "@/lib/agentes.functions";

export const Route = createFileRoute("/agentes")({
  component: () => (
    <RequireAuth path="/agentes">
      <AgentesPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Equipo Operativo" }] }),
});

type HubOption = { id: string; nombre: string; marca: string };

type AgenteDef = {
  id: string;
  nombre: string;
  descripcion: string;
  ejecutar: (args: { data: { hub_id: string } }) => Promise<ResultadoAgente>;
};

function AgentesPage() {
  const alertasKpis = useServerFn(ejecutarAlertasKpis);
  const driverRiesgo = useServerFn(ejecutarDriverRiesgo);
  const clasificadorReclamaciones = useServerFn(ejecutarClasificadorReclamaciones);
  const resumenEjecutivo = useServerFn(ejecutarResumenEjecutivo);
  const prequalificacionLeads = useServerFn(ejecutarPrequalificacionLeads);
  const fraudePudo = useServerFn(ejecutarFraudePudo);
  const listarEjecuciones = useServerFn(listarEjecucionesAgentes);

  const agentes: AgenteDef[] = [
    { id: "alertas_kpis", nombre: "Alertas KPIs", descripcion: "CD5/DSR del hub vs. umbrales (CD5 <95%, DSR <91%).", ejecutar: alertasKpis },
    { id: "driver_riesgo", nombre: "Driver en Riesgo", descripcion: "Incidencia repetida 3+ días, o DSR cayendo sostenido, por driver.", ejecutar: driverRiesgo },
    { id: "clasificador_reclamaciones", nombre: "Clasificador Reclamaciones", descripcion: "Reclamaciones nuevas del día → Categoría A (reparto) / B (producto).", ejecutar: clasificadorReclamaciones },
    { id: "resumen_ejecutivo", nombre: "Resumen Ejecutivo", descripcion: "Semana actual vs. semana anterior: entregas, DSR, reclamaciones.", ejecutar: resumenEjecutivo },
    { id: "prequalificacion_leads", nombre: "Pre-calificación Leads", descripcion: "Leads nuevos con +24h sin contacto.", ejecutar: prequalificacionLeads },
    { id: "fraude_pudo", nombre: "Detección Fraude PUDO", descripcion: "Gap de distancia >250m entre punto registrado y entrega real.", ejecutar: fraudePudo },
  ];

  const { selectedHub, hubs: authHubs } = useAuth();
  // AuthContext ya resuelve "admin ve todos los hubs, el resto solo los
  // suyos" (usuario_hubs) — reusar authHubs tal cual en vez de volver a
  // pedirle la tabla completa a Supabase acá para el caso admin.
  const hubs: HubOption[] = authHubs;
  const [hubId, setHubId] = useState<string>(selectedHub?.id ?? "");
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [resultados, setResultados] = useState<Record<string, ResultadoAgente>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [historial, setHistorial] = useState<AgenteEjecucionRow[]>([]);
  const [loadingHistorial, setLoadingHistorial] = useState(true);

  useEffect(() => {
    if (!hubId && hubs.length > 0) setHubId(hubs[0].id);
  }, [hubs, hubId]);

  const loadHistorial = async (hub: string) => {
    setLoadingHistorial(true);
    try {
      const rows = await listarEjecuciones({ data: { hub_id: hub || null } });
      setHistorial(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error cargando historial");
    } finally {
      setLoadingHistorial(false);
    }
  };

  useEffect(() => {
    if (hubId) {
      void loadHistorial(hubId);
    } else {
      // Sin hub (todavía cargando authHubs, o ninguno disponible): no dejar
      // la tabla en "Cargando…" para siempre.
      setHistorial([]);
      setLoadingHistorial(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubId]);

  const runAgente = async (agente: AgenteDef) => {
    if (!hubId) return;
    setRunning((prev) => new Set(prev).add(agente.id));
    setErrores((prev) => { const n = { ...prev }; delete n[agente.id]; return n; });
    try {
      const resultado = await agente.ejecutar({ data: { hub_id: hubId } });
      setResultados((prev) => ({ ...prev, [agente.id]: resultado }));
      toast.success(`${agente.nombre}: ${resultado.hallazgos.length} hallazgo(s)`);
      void loadHistorial(hubId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error ejecutando el agente";
      setErrores((prev) => ({ ...prev, [agente.id]: msg }));
      toast.error(msg);
    } finally {
      setRunning((prev) => { const n = new Set(prev); n.delete(agente.id); return n; });
    }
  };

  const toggleExpandido = (id: string) => {
    setExpandido((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Equipo Operativo" />
      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-5xl mx-auto space-y-8">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Equipo Operativo</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Fase 1: los 6 agentes trabajadores, disparados manualmente para probar cada uno de forma independiente. El Agente Jefe (interpretación conjunta + Teams) llega en la fase siguiente.
            </p>
          </header>

          <label className="block max-w-xs">
            <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Hub</span>
            <select
              value={hubId}
              onChange={(e) => setHubId(e.target.value)}
              className="w-full appearance-none pl-3 pr-8 py-2 text-sm bg-card border rounded-md text-foreground"
            >
              {hubs.length === 0 && <option value="">Sin hubs disponibles</option>}
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>{h.marca} · {h.nombre}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {agentes.map((agente) => {
              const isRunning = running.has(agente.id);
              const resultado = resultados[agente.id];
              const error = errores[agente.id];
              const isExpandido = expandido.has(agente.id);
              return (
                <Card key={agente.id} className="shadow-none">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-sm font-semibold">{agente.nombre}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">{agente.descripcion}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => void runAgente(agente)} disabled={isRunning || !hubId} className="gap-1.5 shrink-0">
                        {isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                        {isRunning ? "Corriendo…" : "Ejecutar"}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {error && (
                      <div className="px-3 py-2 bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded flex items-start gap-2">
                        <AlertTriangle className="size-3.5 mt-0.5 shrink-0" /> {error}
                      </div>
                    )}
                    {resultado && !error && (
                      <div>
                        <div className="flex items-center gap-2">
                          <StatusIndicator color={resultado.urgencia === "critica" ? "rose" : "emerald"} pulse={false} />
                          <span className="text-sm font-medium text-foreground">
                            {resultado.hallazgos.length} hallazgo(s) — {resultado.urgencia === "critica" ? "crítico" : "informativo"}
                          </span>
                          {resultado.hallazgos.length > 0 && (
                            <button onClick={() => toggleExpandido(agente.id)} className="ml-auto text-muted-foreground hover:text-foreground">
                              {isExpandido ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                            </button>
                          )}
                        </div>
                        {isExpandido && (
                          <ul className="mt-3 space-y-2 border-t pt-3">
                            {resultado.hallazgos.map((h, i) => (
                              <li key={i} className="text-xs">
                                <p className="font-medium text-foreground">{h.titulo as string}</p>
                                <p className="text-muted-foreground">{h.detalle as string}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {!resultado && !error && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <CheckCircle2 className="size-3.5" /> Sin correr todavía en esta sesión.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <section className="space-y-3">
            <h2 className="text-base font-semibold tracking-tight text-foreground">Historial de ejecuciones</h2>
            <Card className="shadow-none overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted">
                        <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Agente</th>
                        <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Fecha</th>
                        <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Estado</th>
                        <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Hallazgos</th>
                        <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Duración</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingHistorial ? (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-xs">Cargando…</td></tr>
                      ) : historial.length === 0 ? (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-xs">Sin ejecuciones todavía</td></tr>
                      ) : (
                        historial.map((h) => (
                          <tr key={h.id} className="border-t border-border">
                            <td className="px-4 py-2 text-foreground whitespace-nowrap">{h.agente}</td>
                            <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{new Date(h.ejecutado_en).toLocaleString("es-ES")}</td>
                            <td className="px-4 py-2">
                              {!h.exito ? (
                                <span className="text-destructive text-xs">Error{h.error ? `: ${h.error}` : ""}</span>
                              ) : (
                                <span className={`inline-flex items-center gap-1.5 text-xs ${h.urgencia === "critica" ? "text-destructive" : "text-muted-foreground"}`}>
                                  <StatusIndicator color={h.urgencia === "critica" ? "rose" : "emerald"} pulse={false} />
                                  {h.urgencia === "critica" ? "Crítico" : "Informativo"}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-foreground">{h.hallazgos?.length ?? 0}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{h.duracion_ms != null ? `${h.duracion_ms}ms` : "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
