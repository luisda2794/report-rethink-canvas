"use client";

import { useNavigate } from "@tanstack/react-router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOutIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABEL } from "@/lib/roles";

export function NavUser() {
  const { user, profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const name = profile?.full_name || user?.email || "Usuario";
  const initial = (name[0] ?? "?").toUpperCase();

  const handleLogout = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar className="size-8 cursor-pointer">
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-3">
          <Avatar className="size-10">
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="font-medium text-foreground truncate">{name}</div>
            <div className="text-muted-foreground text-xs truncate">
              {user?.email}
            </div>
            {role && (
              <div className="text-muted-foreground text-[10px] uppercase tracking-wide mt-0.5">
                {ROLE_LABEL[role]}
              </div>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="w-full cursor-pointer text-destructive focus:text-destructive"
            onClick={handleLogout}
          >
            <LogOutIcon />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
