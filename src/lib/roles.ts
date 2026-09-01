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
export const ALL_NAV: NavItem[] = [
  { to: "/epod", label: "ePOD" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/mapa-entregas", label: "Mapa de Entregas" },
  { to: "/reportes", label: "KPIs" },
  { to: "/paquetes-en-riesgo", label: "Paquetes en Riesgo" },
  { to: "/flow-meeting", label: "Flow Meeting" },
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
    "/reportes",
    "/paquetes-en-riesgo",
    "/flow-meeting",
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
    "/reportes",
    "/paquetes-en-riesgo",
    "/flow-meeting",
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
    "/reportes",
    "/paquetes-en-riesgo",
    "/flow-meeting",
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
