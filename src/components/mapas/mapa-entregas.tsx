import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Loader2, MapPin } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEpodDates, useEpodLineasForDay } from "@/components/mapas/use-mapa-entregas";
import { MapaEntregasView } from "@/components/mapas/mapa-entregas-view";
import { classifyEstado, STATUS_COLOR, STATUS_LABEL, type EntregaStatus } from "@/components/mapas/mapa-entregas-status";
import "./mapa.css";

function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const label = d.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const COUNTED_STATUSES: EntregaStatus[] = ["entregado", "incidencia", "en_reparto"];

export function MapaEntregas() {
  const { selectedHub } = useAuth();
  const hubId = selectedHub?.id ?? null;

  const { data: dates, isLoading: datesLoading } = useEpodDates(hubId);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    setSelectedDate(dates && dates.length > 0 ? dates[0] : null);
  }, [dates]);

  const { data: rows, isLoading: rowsLoading, isError, error } = useEpodLineasForDay(hubId, selectedDate);

  const stats = useMemo(() => {
    const all = rows ?? [];
    const withLocation = all.filter((r) => r.latitude != null && r.longitude != null);
    const counts: Record<EntregaStatus, number> = { entregado: 0, incidencia: 0, en_reparto: 0, otro: 0 };
    for (const r of all) counts[classifyEstado(r.estado)]++;
    return { total: all.length, withLocation, withoutLocation: all.length - withLocation.length, counts };
  }, [rows]);

  const pct = (n: number) => (stats.total > 0 ? ((n / stats.total) * 100).toFixed(1) : "0.0");

  if (!hubId || !selectedHub) {
    return (
      <div className="mapa-loading">
        <AlertCircle className="size-5 text-muted-foreground" />
        Selecciona un hub arriba para ver el mapa de entregas.
      </div>
    );
  }

  return (
    <div className="mapa-page">
      <header className="mapa-page__header">
        <div className="flex items-center gap-2">
          <MapPin className="size-5 text-muted-foreground" />
          <div>
            <h1 className="mapa-page__title">Mapa de Entregas</h1>
            <p className="mapa-page__subtitle">
              {selectedHub.marca} · {selectedHub.nombre}
            </p>
          </div>
        </div>
        <Select
          value={selectedDate ?? undefined}
          onValueChange={setSelectedDate}
          disabled={datesLoading || !dates || dates.length === 0}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={datesLoading ? "Cargando…" : "Selecciona un día"} />
          </SelectTrigger>
          <SelectContent>
            {(dates ?? []).map((d) => (
              <SelectItem key={d} value={d}>
                {formatDateLabel(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {!datesLoading && (!dates || dates.length === 0) ? (
        <div className="mapa-loading">
          Sin ePOD cargado todavía para este hub.{" "}
          <Link to="/epod" className="underline underline-offset-2 hover:text-foreground">
            Sube un ePOD
          </Link>{" "}
          para empezar.
        </div>
      ) : (
        <>
          <div className="mapa-entregas-stats">
            {COUNTED_STATUSES.map((status) => (
              <div key={status} className="mapa-entregas-stat" style={{ borderTopColor: STATUS_COLOR[status] }}>
                <div className="mapa-entregas-stat__value" style={{ color: STATUS_COLOR[status] }}>
                  {stats.counts[status]}
                </div>
                <div className="mapa-entregas-stat__pct">{pct(stats.counts[status])}% del día</div>
                <div className="mapa-entregas-stat__label">{STATUS_LABEL[status]}</div>
              </div>
            ))}
          </div>

          <div className="mapa-page__map mapa-entregas__map">
            {rowsLoading ? (
              <div className="mapa-loading">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                Cargando entregas…
              </div>
            ) : isError ? (
              <div className="mapa-error">
                <AlertCircle className="size-5 text-destructive" />
                {error instanceof Error ? error.message : "No se pudieron cargar las entregas."}
              </div>
            ) : (
              <MapaEntregasView rows={stats.withLocation} />
            )}
          </div>

          {stats.withoutLocation > 0 && (
            <p className="mapa-entregas__footnote">
              {stats.withoutLocation} paquete{stats.withoutLocation === 1 ? "" : "s"} sin ubicación, no
              mostrado{stats.withoutLocation === 1 ? "" : "s"} en el mapa.
            </p>
          )}
        </>
      )}
    </div>
  );
}
