import { useQuery } from "@tanstack/react-query";
import { AlertOctagon } from "lucide-react";
import { format, subDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

// Desglose de incidencias (exception_detail) por tipo, últimos 7 días —
// widget #4 del Dashboard. Agregado en SQL (dashboard_incidencias_stats)
// sobre epod_lineas.

type IncidenciaAgg = { motivo: string; n: number };

function useIncidenciasStats(hubIds: string[]) {
  const to = format(new Date(), "yyyy-MM-dd");
  const from = format(subDays(new Date(), 6), "yyyy-MM-dd");
  return useQuery({
    queryKey: ["dashboard-incidencias", hubIds.slice().sort().join(","), from, to],
    enabled: hubIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<IncidenciaAgg[]> => {
      const { data, error } = await supabase.rpc("dashboard_incidencias_stats", {
        _hub_ids: hubIds,
        _from: from,
        _to: to,
      });
      if (error) throw error;
      return (data ?? []) as IncidenciaAgg[];
    },
  });
}

function IncBar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DashboardIncidencias({ hubIds }: { hubIds: string[] }) {
  const { data, isLoading, isError } = useIncidenciasStats(hubIds);
  const rows = data ?? [];
  const max = rows.length > 0 ? rows[0].n : 0;

  if (hubIds.length === 0) return null;

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertOctagon className="size-4 text-primary" /> Incidencias por tipo (7 días)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-sm text-destructive">No se pudieron cargar las incidencias.</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin incidencias en los últimos 7 días ✓</p>
        ) : (
          <ul className="space-y-2">
            {rows.slice(0, 10).map((r) => (
              <li key={r.motivo} className="flex items-center gap-3 text-[13px]">
                <span className="flex-1 min-w-0 truncate" title={r.motivo}>
                  {r.motivo}
                </span>
                <IncBar count={r.n} max={max} />
                <span className="w-8 text-right tabular-nums font-semibold">{r.n}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
