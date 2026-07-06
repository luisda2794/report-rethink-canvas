export type Role = "admin" | "manager" | "jefe_flota" | "contable" | "customer";

export const ALL_ROLES: Role[] = ["admin", "manager", "jefe_flota", "contable", "customer"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  jefe_flota: "Jefe de flota",
  contable: "Contable",
  customer: "Cliente",
};

export type NavItem = { to: string; label: string };

export const ALL_NAV: NavItem[] = [
  { to: "/epod", label: "ePOD" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/reportes", label: "Reportes" },
  { to: "/borradores", label: "Borradores" },
  { to: "/facturacion", label: "Facturación" },
  { to: "/reclamaciones", label: "Reclamaciones" },
  { to: "/mapas-provincia", label: "Mapas Provincia" },
  { to: "/cd13", label: "Mapa CD13" },
  { to: "/mapas-admin", label: "Admin mapas" },
  { to: "/admin", label: "Admin" },
];

export const ROUTE_ACCESS: Record<Role, string[]> = {
  admin: [
    "/epod",
    "/dashboard",
    "/reportes",
    "/borradores",
    "/facturacion",
    "/reclamaciones",
    "/mapas-provincia",
    "/cd13",
    "/mapas-admin",
    "/admin",
  ],
  manager: ["/epod", "/dashboard", "/reportes", "/reclamaciones", "/mapas-provincia", "/cd13", "/mapas-admin"],
  jefe_flota: ["/epod", "/dashboard", "/reportes", "/reclamaciones", "/mapas-provincia"],
  contable: ["/borradores", "/facturacion"],
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
