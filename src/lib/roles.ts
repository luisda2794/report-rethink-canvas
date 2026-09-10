export type Role = "admin" | "manager" | "jefe_flota" | "contable" | "jefe_contable" | "customer";

export const ALL_ROLES: Role[] = ["admin", "manager", "jefe_flota", "contable", "jefe_contable", "customer"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  jefe_flota: "Jefe de flota",
  contable: "Contable",
  jefe_contable: "Jefe Contable",
  customer: "Cliente",
};

export type NavItem = { to: string; label: string };

// Nota: "/duplicados" y "/mapas-provincia" se acceden ahora desde tarjetas
// dentro de /reportes (no del nav lateral), y "/mapas-admin" está oculto del
// nav por no usarse. Los tres siguen siendo rutas válidas — ver ROUTE_ACCESS,
// que no cambia — así que el acceso directo por URL sigue funcionando.
//
// "/drivers" y "/borradores" (Drivers y Facturación por driver+CP) existían
// antes, se desactivaron al no estar en ROUTE_ACCESS de ningún rol (RequireAuth
// redirige si canAccess() da false — así es como se "apagó" el módulo, no
// borrando el código) y se reactivan acá para admin/manager (edición directa)
// y jefe_flota (solo modo "solicitar cambio" — ver TarifasSection en
// borradores.tsx, gateado también a nivel RLS, no solo de UI).
//
// "/aprobaciones" es nueva: panel de aprobación de solicitudes de tarifa,
// uno por etapa (manager ve su etapa, jefe_contable la suya, admin ambas +
// aplica el cambio final). Ver solicitudes_tarifa.
//
// "/cainiao-pagos" es nueva: reconciliación de pagos Cainiao (sube el bill
// quincenal, cruza contra entregas, compara contra lo pagado a drivers).
// Solo admin/manager/jefe_contable — es un módulo financiero/de auditoría,
// no operativo del día a día.
//
// "/paquetes-en-riesgo" y "/flow-meeting" eran pestañas dentro de "/reportes"
// (KPIs) y se movieron a rutas propias en el nav, al mismo nivel que el
// resto — mismo acceso que ya tenía /reportes (admin/manager/jefe_flota),
// ya que son herramientas operativas del día a día, no financieras.
//
// "/pudos" es nueva: gap de distancia GPS en entregas PUDO, se revisa a
// diario — mismo acceso operativo que /paquetes-en-riesgo/flow-meeting
// (admin/manager/jefe_flota), no es un módulo financiero.
//
// "/buscador" es nueva: Buscador de Paquetes por Waybill/LP (trayectoria,
// intentos de entrega, incidencias, gap de distancia, CD actual). Mismo
// acceso operativo del día a día que /paquetes-en-riesgo y /pudos
// (admin/manager/jefe_flota) — no filtra por hub seleccionado, encuentra el
// paquete en cualquier hub al que el usuario tenga acceso (RLS de
// epod_lineas ya lo restringe).
//
// "/leads" es nueva: Reclutamiento de Repartidores. admin/manager ven todos
// los leads (incluidos los "sin asignar" por CP), jefe_flota ve solo los de
// su hub. "/reclutamiento" (el formulario público para Milanuncios) NO va
// acá — es una ruta pública sin RequireAuth, como "/rec/$token".
//
// "/agentes" (Equipo Operativo, los 6 agentes trabajadores) es solo admin —
// decisión explícita del usuario: se le quitó el acceso a manager (lo tenía
// en la fase 1) para mantener ese panel restringido a administradores.
//
// "/helm" es nueva: Helm, orquestación de agentes de NEGOCIO (ventas/
// comunicaciones/finanzas) — módulo separado del Equipo Operativo (que es
// operativo/logístico, por hub). Fase 1 = shell de control, sin LLM ni
// integraciones reales todavía. Solo admin, mismo criterio que /agentes;
// posible candidato a exportarse como producto separado más adelante (de
// ahí el prefijo helm_ en sus tablas).
export const ALL_NAV: NavItem[] = [
  { to: "/epod", label: "ePOD" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/mapa-entregas", label: "Mapa de Entregas" },
  { to: "/buscador", label: "Buscador de Paquetes" },
  { to: "/reportes", label: "KPIs" },
  { to: "/paquetes-en-riesgo", label: "Paquetes en Riesgo" },
  { to: "/flow-meeting", label: "Flow Meeting" },
  { to: "/pudos", label: "PUDOs" },
  { to: "/leads", label: "Leads" },
  { to: "/agentes", label: "Equipo Operativo" },
  { to: "/helm", label: "Helm" },
  { to: "/reclamaciones", label: "Reclamaciones" },
  { to: "/drivers", label: "Drivers" },
  { to: "/borradores", label: "Facturación" },
  { to: "/aprobaciones", label: "Aprobaciones" },
  { to: "/cainiao-pagos", label: "Pagos Cainiao" },
  { to: "/admin", label: "Admin" },
];

export const ROUTE_ACCESS: Record<Role, string[]> = {
  admin: [
    "/epod",
    "/dashboard",
    "/mapa-entregas",
    "/buscador",
    "/reportes",
    "/paquetes-en-riesgo",
    "/flow-meeting",
    "/pudos",
    "/leads",
    "/agentes",
    "/helm",
    "/duplicados",
    "/reclamaciones",
    "/mapas-provincia",
    "/mapas-admin",
    "/drivers",
    "/borradores",
    "/aprobaciones",
    "/cainiao-pagos",
    "/admin",
  ],
  manager: [
    "/epod",
    "/dashboard",
    "/mapa-entregas",
    "/buscador",
    "/reportes",
    "/paquetes-en-riesgo",
    "/flow-meeting",
    "/pudos",
    "/leads",
    "/duplicados",
    "/reclamaciones",
    "/mapas-provincia",
    "/mapas-admin",
    "/drivers",
    "/borradores",
    "/aprobaciones",
    "/cainiao-pagos",
  ],
  jefe_flota: [
    "/epod",
    "/dashboard",
    "/mapa-entregas",
    "/buscador",
    "/reportes",
    "/paquetes-en-riesgo",
    "/flow-meeting",
    "/pudos",
    "/leads",
    "/duplicados",
    "/reclamaciones",
    "/mapas-provincia",
    "/drivers",
    "/borradores",
  ],
  contable: [],
  jefe_contable: ["/aprobaciones", "/cainiao-pagos"],
  customer: ["/reclamaciones"],
};


export function navForRole(role: Role | null | undefined): NavItem[] {
  if (!role) return [];
  const allowed = new Set(ROUTE_ACCESS[role]);
  return ALL_NAV.filter((n) => allowed.has(n.to));
}

export function firstAllowedRoute(role: Role | null | undefined): string {
  if (!role) return "/login";
  return ROUTE_ACCESS[role]?.[0] ?? "/login";
}

export function canAccess(role: Role | null | undefined, path: string): boolean {
  if (!role) return false;
  return ROUTE_ACCESS[role].includes(path);
}
