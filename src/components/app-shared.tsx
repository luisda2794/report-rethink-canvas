import type { ReactNode } from "react";
import {
  LayoutGridIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileEditIcon,
  ReceiptIcon,
  AlertOctagonIcon,
  AlertTriangleIcon,
  ClipboardListIcon,
  MapIcon,
  MapPinIcon,
  FlameIcon,
  SettingsIcon,
  ShieldIcon,
  HelpCircleIcon,
  BookOpenIcon,
  CopyIcon,
  UsersIcon,
  CheckCircle2Icon,
} from "lucide-react";
import { navForRole, type Role } from "@/lib/roles";

export type SidebarNavItem = {
  title: string;
  path?: string;
  icon?: ReactNode;
  isActive?: boolean;
  subItems?: SidebarNavItem[];
};

export type SidebarNavGroup = {
  label?: string;
  items: SidebarNavItem[];
};

const ICONS: Record<string, ReactNode> = {
  "/dashboard": <LayoutGridIcon />,
  "/epod": <FileSpreadsheetIcon />,
  "/mapa-entregas": <MapPinIcon />,
  "/reportes": <FileTextIcon />,
  "/paquetes-en-riesgo": <AlertTriangleIcon />,
  "/flow-meeting": <ClipboardListIcon />,
  "/duplicados": <CopyIcon />,
  "/reclamaciones": <AlertOctagonIcon />,
  "/mapas-provincia": <MapIcon />,
  "/cd5": <FlameIcon />,
  "/mapas-admin": <SettingsIcon />,
  "/drivers": <UsersIcon />,
  "/borradores": <ReceiptIcon />,
  "/aprobaciones": <CheckCircle2Icon />,
  "/admin": <ShieldIcon />,
};

const GROUP_OF: Record<string, string> = {
  "/dashboard": "Operación",
  "/epod": "Operación",
  "/mapa-entregas": "Operación",
  "/reportes": "Operación",
  "/paquetes-en-riesgo": "Operación",
  "/flow-meeting": "Operación",
  "/duplicados": "Operación",
  "/reclamaciones": "Soporte",
  "/mapas-provincia": "Operación",
  "/cd5": "Operación",
  "/mapas-admin": "Operación",
  "/drivers": "Facturación",
  "/borradores": "Facturación",
  "/aprobaciones": "Facturación",
  "/admin": "Administración",
};


export function buildNavGroups(
  role: Role | null | undefined,
  currentPath: string,
): SidebarNavGroup[] {
  const items = navForRole(role);
  const byGroup = new Map<string, SidebarNavItem[]>();
  for (const it of items) {
    const group = GROUP_OF[it.to] ?? "General";
    const arr = byGroup.get(group) ?? [];
    arr.push({
      title: it.label,
      path: it.to,
      icon: ICONS[it.to],
      isActive: currentPath === it.to || currentPath.startsWith(it.to + "/"),
    });
    byGroup.set(group, arr);
  }
  return Array.from(byGroup.entries()).map(([label, items]) => ({ label, items }));
}

export const footerNavLinks: SidebarNavItem[] = [
  { title: "Ayuda", path: "#", icon: <HelpCircleIcon /> },
  { title: "Documentación", path: "#", icon: <BookOpenIcon /> },
];

export function findActive(groups: SidebarNavGroup[]): SidebarNavItem | undefined {
  for (const g of groups) {
    for (const it of g.items) if (it.isActive) return it;
  }
  return undefined;
}
