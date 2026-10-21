import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Maximize2, Play, X } from "lucide-react";
import { StatusIndicator } from "@/components/indicator";
import { useAuth } from "@/contexts/AuthContext";
import {
  ejecutarAgenteHelm,
  obtenerCentroDeMandoHelm,
  type HelmAgente,
  type HelmCategoria,
  type HelmCentroDeMando,
} from "@/lib/helm.functions";
import {
  CATEGORIA_LABEL,
  CATEGORIA_LINE_STROKE,
  ESTADO_AGENTE_COLOR,
  ESTADO_AGENTE_DOT_FILL,
  GRAFO_CX,
  GRAFO_CY,
  agruparPorCategoria,
  computeGrafoLayout,
  isHoy,
} from "@/lib/helm-grafo";

// ============================================================
// Centro de Mando: pestaña de /dashboard con el grafo de agentes Helm en
// tema oscuro (misma geometría que /helm vía computeGrafoLayout), brillo
// pulsante y líneas de energía animadas — solo SVG + CSS @keyframes.
// Se ve embebido en la pestaña y se puede abrir a pantalla completa.
// Lo ven admin/manager/jefe_flota; "Ejecutar ahora" solo admin.
// ============================================================

const REFRESCO_MS = 60_000;

const CATEGORIA_HUB_GLOW_FILL: Record<HelmCategoria, string> = {
  ventas: "fill-rose-400",
  comunicaciones: "fill-sky-400",
  finanzas: "fill-emerald-400",
};

const CATEGORIA_PILL_DARK: Record<HelmCategoria, string> = {
  ventas: "bg-rose-400/10 text-rose-300",
  comunicaciones: "bg-sky-400/10 text-sky-300",
  finanzas: "bg-emerald-400/10 text-emerald-300",
};

type Stats = {
  agentesActivos: number;
  ejecucionesHoy: number;
  tareasHoy: number;
  aprobacionesPendientes: number;
};

const STATS_LABEL: { key: keyof Stats; label: string }[] = [
  { key: "agentesActivos", label: "Agentes activos" },
  { key: "ejecucionesHoy", label: "Ejecuciones hoy" },
  { key: "tareasHoy", label: "Tareas hoy" },
  { key: "aprobacionesPendientes", label: "Aprobaciones pendientes" },
];

const ESTILOS_ANIMACION = `
  @keyframes helm-cdm-pulse-glow {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
  }
  @keyframes helm-cdm-dash {
    to { stroke-dashoffset: -20; }
  }
  @keyframes helm-cdm-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }
  .helm-cdm-pulse {
    animation: helm-cdm-pulse-glow 2.4s ease-in-out infinite;
  }
  .helm-cdm-flow {
    stroke-dasharray: 4 6;
    animation: helm-cdm-dash 1s linear infinite;
  }
  .helm-cdm-live-dot {
    animation: helm-cdm-blink 1.4s ease-in-out infinite;
  }
`;

function HelmGraphDark({
  agentes,
  selectedId,
  onSelect,
}: {
  agentes: HelmAgente[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const layout = useMemo(() => computeGrafoLayout(agruparPorCategoria(agentes)), [agentes]);

  return (
    <svg viewBox="0 0 1000 560" className="w-full h-full" role="img" aria-label="Centro de mando: mapa de agentes Helm">
      <defs>
        <filter id="helm-cdm-glow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="9" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {layout.map(({ categoria, hub, labelPos, agentes: nodos }) => (
        <g key={categoria}>
          <line
            x1={GRAFO_CX}
            y1={GRAFO_CY}
            x2={hub.x}
            y2={hub.y}
            className={`${CATEGORIA_LINE_STROKE[categoria]} helm-cdm-flow`}
            strokeWidth={2}
            opacity={0.8}
          />

          {nodos.map(({ agente, x, y, lineas }) => {
            const isSelected = selectedId === agente.id;
            return (
              <g key={agente.id}>
                <line
                  x1={hub.x}
                  y1={hub.y}
                  x2={x}
                  y2={y}
                  className={`${CATEGORIA_LINE_STROKE[categoria]} helm-cdm-flow`}
                  strokeWidth={1.5}
                  opacity={0.5}
                />
                <g
                  className="cursor-pointer"
                  onClick={() => onSelect(agente.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(agente.id); }}
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={isSelected ? 23 : 20}
                    className={`fill-[#05070b] ${CATEGORIA_LINE_STROKE[categoria]}`}
                    fillOpacity={0.75}
                    strokeWidth={isSelected ? 2 : 1.25}
                  />
                  <circle
                    cx={x + 14}
                    cy={y - 14}
                    r={4.5}
                    className={`${ESTADO_AGENTE_DOT_FILL[agente.estado]} helm-cdm-pulse`}
                    filter="url(#helm-cdm-glow)"
                  />
                  <text x={x} y={y + 35} textAnchor="middle" className="fill-slate-200 font-mono text-[10px]">
                    {lineas.map((linea, li) => (
                      <tspan key={li} x={x} dy={li === 0 ? 0 : "1.15em"}>
                        {linea}
                      </tspan>
                    ))}
                  </text>
                </g>
              </g>
            );
          })}

          <circle
            cx={hub.x}
            cy={hub.y}
            r={24}
            className={`${CATEGORIA_HUB_GLOW_FILL[categoria]} helm-cdm-pulse`}
            filter="url(#helm-cdm-glow)"
          />
          <circle cx={hub.x} cy={hub.y} r={20} className={CATEGORIA_HUB_GLOW_FILL[categoria]} />
          <text
            x={labelPos.x}
            y={labelPos.y}
            textAnchor="middle"
            className="fill-slate-300 font-mono text-[11px] font-semibold uppercase tracking-wide"
          >
            {CATEGORIA_LABEL[categoria]}
          </text>
        </g>
      ))}

      <circle cx={GRAFO_CX} cy={GRAFO_CY} r={42} className="fill-electric helm-cdm-pulse" filter="url(#helm-cdm-glow)" />
      <circle cx={GRAFO_CX} cy={GRAFO_CY} r={36} className="fill-electric" />
      <text x={GRAFO_CX} y={GRAFO_CY + 5} textAnchor="middle" className="fill-white font-mono text-sm font-bold uppercase tracking-wide">
        Helm
      </text>
    </svg>
  );
}

// Componente aparte para que el tic de cada segundo no re-renderice el grafo.
function RelojEnVivo() {
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex items-center gap-2.5">
      <span className="relative flex h-2.5 w-2.5">
        <span className="helm-cdm-live-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
      </span>
      <span className="text-[11px] font-mono uppercase tracking-widest text-emerald-400">En vivo</span>
      <span className="text-[11px] font-mono text-slate-500">{ahora.toLocaleTimeString("es-ES")}</span>
    </div>
  );
}

const GLASS = "bg-white/5 backdrop-blur border border-white/10 rounded-lg";

export function CentroDeMando() {
  const { role } = useAuth();
  const esAdmin = role === "admin";
  const obtenerCentroDeMando = useServerFn(obtenerCentroDeMandoHelm);
  const ejecutarAgente = useServerFn(ejecutarAgenteHelm);

  const [datos, setDatos] = useState<HelmCentroDeMando | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ejecutando, setEjecutando] = useState<Set<string>>(new Set());
  const [pantallaCompleta, setPantallaCompleta] = useState(false);

  const cargar = async () => {
    try {
      setDatos(await obtenerCentroDeMando());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando el Centro de Mando");
    }
  };

  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), REFRESCO_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!pantallaCompleta) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPantallaCompleta(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pantallaCompleta]);

  const runAgente = async (agente: HelmAgente) => {
    setEjecutando((prev) => new Set(prev).add(agente.id));
    try {
      await ejecutarAgente({ data: { agente_id: agente.id } });
      toast.success(`${agente.nombre}: ejecución completada`);
      await cargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error ejecutando el agente");
    } finally {
      setEjecutando((prev) => { const n = new Set(prev); n.delete(agente.id); return n; });
    }
  };

  const agentes = datos?.agentes ?? [];

  const stats = useMemo<Stats>(() => {
    const ejecucionesHoy = (datos?.ejecucionesRecientes ?? []).filter((e) => isHoy(e.iniciado_en));
    return {
      agentesActivos: agentes.filter((a) => a.estado === "activo").length,
      ejecucionesHoy: ejecucionesHoy.length,
      tareasHoy: ejecucionesHoy.reduce((s, e) => s + e.tareas_completadas, 0),
      aprobacionesPendientes: datos?.aprobacionesPendientes ?? 0,
    };
  }, [datos, agentes]);

  const selectedAgente = useMemo(() => agentes.find((a) => a.id === selectedId) ?? null, [agentes, selectedId]);

  if (!datos) {
    return error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <p className="text-sm text-muted-foreground">Cargando Centro de Mando…</p>
    );
  }

  return (
    <div
      className={
        pantallaCompleta
          ? "fixed inset-0 z-[100] bg-[#05070b] overflow-hidden"
          : "relative h-[calc(100vh-11rem)] min-h-[600px] rounded-lg bg-[#05070b] overflow-hidden"
      }
    >
      <style>{ESTILOS_ANIMACION}</style>

      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(circle at 50% 45%, rgba(56,189,248,0.10), transparent 60%)" }}
      />

      <div className="relative h-full w-full flex flex-col">
        <div className="flex items-center justify-between gap-3 px-6 py-4 shrink-0">
          <RelojEnVivo />
          {pantallaCompleta ? (
            <button
              onClick={() => setPantallaCompleta(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/10 text-slate-300 text-xs font-mono uppercase tracking-wide hover:bg-white/10"
            >
              <X className="size-3.5" />
              Cerrar
            </button>
          ) : (
            <button
              onClick={() => setPantallaCompleta(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-white/10 text-slate-300 text-xs font-mono uppercase tracking-wide hover:bg-white/10"
            >
              <Maximize2 className="size-3.5" />
              Pantalla completa
            </button>
          )}
        </div>

        {!pantallaCompleta && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-6 shrink-0">
            {STATS_LABEL.map(({ key, label }) => (
              <div key={key} className={`${GLASS} px-3 py-2`}>
                <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">{label}</p>
                <p className="text-lg font-semibold text-slate-100">{stats[key]}</p>
              </div>
            ))}
          </div>
        )}

        <div className="relative flex-1 min-h-0">
          <div className="absolute inset-0 p-4">
            <HelmGraphDark agentes={agentes} selectedId={selectedId} onSelect={setSelectedId} />
          </div>

          {pantallaCompleta && (
            <>
              <div className="absolute left-6 top-6 w-56 hidden lg:block">
                <div className={`${GLASS} p-4`}>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400 mb-3">Estado general</p>
                  <div className="space-y-3">
                    {STATS_LABEL.map(({ key, label }) => (
                      <div key={key}>
                        <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">{label}</p>
                        <p className="text-xl font-semibold text-slate-100">{stats[key]}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="absolute right-6 top-6 bottom-6 w-64 hidden lg:flex flex-col pointer-events-none">
                <div className={`${GLASS} p-3 flex-1 min-h-0 flex flex-col pointer-events-auto`}>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400 px-1 pb-2 shrink-0">Agentes</p>
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
                    {agentes.map((agente) => (
                      <button
                        key={agente.id}
                        onClick={() => setSelectedId(agente.id)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                          selectedId === agente.id ? "bg-white/10" : "hover:bg-white/5"
                        }`}
                      >
                        <StatusIndicator color={ESTADO_AGENTE_COLOR[agente.estado]} pulse={agente.estado === "activo"} />
                        <span className="text-xs text-slate-200 truncate">{agente.nombre}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {selectedAgente && (
            <div className="absolute left-1/2 -translate-x-1/2 bottom-6 w-[min(90%,32rem)]">
              <div className={`${GLASS} p-4 flex items-start justify-between gap-4 flex-wrap`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusIndicator color={ESTADO_AGENTE_COLOR[selectedAgente.estado]} pulse={selectedAgente.estado === "activo"} />
                    <p className="text-sm font-semibold text-slate-100">{selectedAgente.nombre}</p>
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${CATEGORIA_PILL_DARK[selectedAgente.categoria]}`}>
                      {CATEGORIA_LABEL[selectedAgente.categoria]}
                    </span>
                  </div>
                  {selectedAgente.descripcion && <p className="text-xs text-slate-400 mt-1.5">{selectedAgente.descripcion}</p>}
                  <p className="text-[11px] text-slate-500 mt-1 font-mono">
                    {selectedAgente.ultima_ejecucion_en
                      ? `Última: ${new Date(selectedAgente.ultima_ejecucion_en).toLocaleString("es-ES")}`
                      : "Sin ejecuciones"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {esAdmin && (
                    <button
                      onClick={() => void runAgente(selectedAgente)}
                      disabled={ejecutando.has(selectedAgente.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-electric text-white rounded text-xs font-mono uppercase tracking-wide hover:opacity-90 disabled:opacity-50"
                    >
                      {ejecutando.has(selectedAgente.id) ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                      {ejecutando.has(selectedAgente.id) ? "Ejecutando…" : "Ejecutar ahora"}
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedId(null)}
                    aria-label="Cerrar detalle"
                    className="p-1.5 rounded text-slate-400 hover:bg-white/10"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
