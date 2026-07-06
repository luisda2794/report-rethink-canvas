import { Check, ChevronsUpDown, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";

export function HubSwitcher() {
  const { hubs, selectedHub, setSelectedHub } = useAuth();

  if (hubs.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 max-w-[220px]"
        >
          <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs">
            {selectedHub ? `${selectedHub.marca} · ${selectedHub.nombre}` : "Selecciona hub"}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">Hubs disponibles</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hubs.map((h) => (
          <DropdownMenuItem
            key={h.id}
            onClick={() => setSelectedHub(h)}
            className="flex items-center justify-between gap-2 cursor-pointer"
          >
            <div className="min-w-0">
              <div className="text-sm truncate">{h.marca} · {h.nombre}</div>
              {h.ciudad && (
                <div className="text-[10px] text-muted-foreground truncate">{h.ciudad}</div>
              )}
            </div>
            {selectedHub?.id === h.id && <Check className="size-4 text-primary shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
