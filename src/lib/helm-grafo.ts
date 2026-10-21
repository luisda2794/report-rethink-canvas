import type { HelmAgente, HelmAgenteEstado, HelmCategoria } from "@/lib/helm.functions";

// ============================================================
// Grafo radial de agentes Helm: hub central "Helm" -> 3 hubs de categoría
// (a radio GRAFO_R1, ángulos fijos) -> agentes de cada categoría (a radio
// GRAFO_R2 desde SU hub de categoría, en abanico hacia afuera del centro).
// Todo calculado a partir de los agentes reales, nada hardcodeado salvo
// los ángulos/radios del layout.
//
// Lo comparten el grafo claro de /helm y el Centro de Mando oscuro de
// /dashboard, para que ambas vistas dibujen exactamente los mismos datos en
// las mismas posiciones.
//
// Convención de ángulo: 0° = arriba, sentido horario.
// x = cx + r*sin(ángulo), y = cy - r*cos(ángulo).
// ============================================================
export const GRAFO_CX = 500;
export const GRAFO_CY = 300;
const GRAFO_R1 = 170; // centro -> hub de categoría
const GRAFO_R2 = 95; // hub de categoría -> agente
const GRAFO_SPREAD_DEG = 35; // apertura del abanico de agentes a cada lado del ángulo base

const CATEGORIA_ANGLE: Record<HelmCategoria, number> = {
  comunicaciones: 0,
  finanzas: 120,
  ventas: 240,
};

export const CATEGORIA_LABEL: Record<HelmCategoria, string> = {
  ventas: "Ventas",
  comunicaciones: "Comunicaciones",
  finanzas: "Finanzas",
};

export const CATEGORIA_LINE_STROKE: Record<HelmCategoria, string> = {
  ventas: "stroke-rose-400",
  comunicaciones: "stroke-sky-400",
  finanzas: "stroke-emerald-400",
};

export const ESTADO_AGENTE_COLOR: Record<HelmAgenteEstado, "emerald" | "amber" | "rose"> = {
  activo: "emerald",
  pausado: "amber",
  error: "rose",
};

export const ESTADO_AGENTE_DOT_FILL: Record<HelmAgenteEstado, string> = {
  activo: "fill-emerald-500",
  pausado: "fill-amber-500",
  error: "fill-rose-500",
};

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function pointOnCircle(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = toRad(angleDeg);
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

// Reparte los agentes de una categoría en abanico alrededor de hubAngle,
// entre -GRAFO_SPREAD_DEG y +GRAFO_SPREAD_DEG (un solo agente va justo en
// hubAngle).
function anguloAgente(hubAngle: number, index: number, total: number): number {
  if (total <= 1) return hubAngle;
  return hubAngle - GRAFO_SPREAD_DEG + (2 * GRAFO_SPREAD_DEG * index) / (total - 1);
}

// Corta el nombre del agente en líneas de ~14 caracteres por palabras
// completas — nunca corta una palabra a la mitad, así el label queda
// legible sin recortar el nombre.
function wrapLabel(nombre: string, maxCharsPerLine = 14): string[] {
  const palabras = nombre.split(" ");
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of palabras) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (candidata.length > maxCharsPerLine && actual) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = candidata;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

export type GrafoAgenteNodo = {
  agente: HelmAgente;
  x: number;
  y: number;
  lineas: string[];
};

export type GrafoCategoriaNodo = {
  categoria: HelmCategoria;
  hubAngle: number;
  hub: { x: number; y: number };
  labelPos: { x: number; y: number };
  agentes: GrafoAgenteNodo[];
};

export function agruparPorCategoria(agentes: HelmAgente[]): Record<HelmCategoria, HelmAgente[]> {
  const grupos: Record<HelmCategoria, HelmAgente[]> = { ventas: [], comunicaciones: [], finanzas: [] };
  for (const a of agentes) grupos[a.categoria].push(a);
  return grupos;
}

export function computeGrafoLayout(agentesPorCategoria: Record<HelmCategoria, HelmAgente[]>): GrafoCategoriaNodo[] {
  const categorias: HelmCategoria[] = ["comunicaciones", "finanzas", "ventas"];
  return categorias.map((categoria) => {
    const hubAngle = CATEGORIA_ANGLE[categoria];
    const hub = pointOnCircle(GRAFO_CX, GRAFO_CY, GRAFO_R1, hubAngle);
    const labelPos = pointOnCircle(GRAFO_CX, GRAFO_CY, GRAFO_R1 - 55, hubAngle);
    const agentesRaw = agentesPorCategoria[categoria];
    const agentes = agentesRaw.map((agente, i) => {
      const agenteAngle = anguloAgente(hubAngle, i, agentesRaw.length);
      const pos = pointOnCircle(hub.x, hub.y, GRAFO_R2, agenteAngle);
      return { agente, x: pos.x, y: pos.y, lineas: wrapLabel(agente.nombre) };
    });
    return { categoria, hubAngle, hub, labelPos, agentes };
  });
}

export function isHoy(iso: string): boolean {
  const d = new Date(iso);
  const hoy = new Date();
  return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate();
}
