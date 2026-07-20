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

// Nota: "/duplicados" y "/mapas-provincia" se acceden ahora desde tarjetas
// dentro de /reportes (no del nav lateral), y "/mapas-admin" está oculto del
// nav por no usarse. Los tres siguen siendo rutas válidas — ver ROUTE_ACCESS,
// que no cambia — así que el acceso directo por URL sigue funcionando.
export const ALL_NAV: NavItem[] = [
  { to: "/epod", label: "ePOD" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/reportes", label: "Reportes" },
  { to: "/reclamaciones", label: "Reclamaciones" },
  { to: "/admin", label: "Admin" },
];

export const ROUTE_ACCESS: Record<Role, string[]> = {
  admin: [
    "/epod",
    "/dashboard",
    "/reportes",
    "/duplicados",
    "/reclamaciones",
    "/mapas-provincia",
    "/mapas-admin",
    "/admin",
  ],
  manager: ["/epod", "/dashboard", "/reportes", "/duplicados", "/reclamaciones", "/mapas-provincia", "/mapas-admin"],
  jefe_flota: ["/epod", "/dashboard", "/reportes", "/duplicados", "/reclamaciones", "/mapas-provincia"],
  contable: [],
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
