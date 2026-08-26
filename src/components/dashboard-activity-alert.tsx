import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Widget #7: si un hub no tiene ningún ePOD subido en las últimas 24-48h,
// se muestra un aviso — para detectar rápido un hub que alguien se olvidó
// de actualizar. Se basa en epod_uploads.created_at (cuándo se subió), no en
// fecha_epod (la fecha que trae el archivo).

type LastUpload = { hub_id: string; last_upload_at: string | null };

function useLastUploads(hubIds: string[]) {
  return useQuery({
    queryKey: ["dashboard-last-upload", hubIds.slice().sort().join(",")],
    enabled: hubIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<LastUpload[]> => {
      const { data, error } = await supabase.rpc("dashboard_last_upload", { _hub_ids: hubIds });
      if (error) throw error;
      return (data ?? []) as LastUpload[];
    },
  });
}

const WARN_HOURS = 24;
const CRITICAL_HOURS = 48;

export function DashboardActivityAlert({ hubIds }: { hubIds: string[] }) {
  const { hubs } = useAuth();
  const { data } = useLastUploads(hubIds);

  const stale = useMemo(() => {
    const now = Date.now();
    const byHub = new Map((data ?? []).map((r) => [r.hub_id, r.last_upload_at]));
    return hubIds
      .map((id) => {
        const hub = hubs.find((h) => h.id === id);
        const lastUploadAt = byHub.get(id) ?? null;
        const hoursSince = lastUploadAt ? (now - new Date(lastUploadAt).getTime()) / 3_600_000 : Infinity;
        return {
          id,
          label: hub ? `${hub.marca} · ${hub.nombre}` : id,
          lastUploadAt,
          hoursSince,
        };
      })
      .filter((h) => h.hoursSince >= WARN_HOURS)
      .sort((a, b) => b.hoursSince - a.hoursSince);
  }, [data, hubIds, hubs]);

  if (stale.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {stale.map((h) => {
        const critical = h.hoursSince >= CRITICAL_HOURS;
        return (
          <div
            key={h.id}
            className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm ${
              critical
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-warn/40 bg-warn/15 text-foreground"
            }`}
          >
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              <strong>{h.label}</strong>: sin ePOD subido
              {h.lastUploadAt
                ? ` desde el ${new Date(h.lastUploadAt).toLocaleString("es-ES", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : " — nunca se subió un ePOD"}
              .
            </span>
          </div>
        );
      })}
    </div>
  );
}
