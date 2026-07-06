import type { ReactNode } from "react";
import {
  LayoutGridIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileEditIcon,
  ReceiptIcon,
  AlertOctagonIcon,
  MapIcon,
  SettingsIcon,
  ShieldIcon,
  HelpCircleIcon,
  BookOpenIcon,
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
  "/reportes": <FileTextIcon />,
  "/borradores": <FileEditIcon />,
  "/facturacion": <ReceiptIcon />,
  "/reclamaciones": <AlertOctagonIcon />,
  "/mapas-provincia": <MapIcon />,
  "/admin": <ShieldIcon />,
};

const GROUP_OF: Record<string, string> = {
  "/dashboard": "Operación",
  "/epod": "Operación",
  "/reportes": "Operación",
  "/borradores": "Facturación",
  "/facturacion": "Facturación",
  "/reclamaciones": "Soporte",
  "/mapas-provincia": "Operación",
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
