import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { DSP_COLORS, DSP_ORDER, type SlaFilter } from "@/components/mapas/types";

type Props = {
  totalCp: number;
  totalVolumen: number;
  perDsp: Record<string, number>;
  activeDsp: string | null;
  slaFilter: SlaFilter;
  onToggleDsp: (dsp: string) => void;
  onChangeSla: (filter: SlaFilter) => void;
};

const SLA_CHIPS: { id: SlaFilter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "t1", label: "Sólo T+1" },
  { id: "t2", label: "Sólo T+2" },
  { id: "t2r", label: "Sólo T+2R" },
];

export function MapaSidebar({
  totalCp,
  totalVolumen,
  perDsp,
  activeDsp,
  slaFilter,
  onToggleDsp,
  onChangeSla,
}: Props) {
  const sortedDsps = useMemo(() => {
    return DSP_ORDER.filter((d) => perDsp[d] !== undefined).sort(
      (a, b) => (perDsp[b] ?? 0) - (perDsp[a] ?? 0),
    );
  }, [perDsp]);

  const fmtVol = (n: number) => n.toLocaleString("es-ES");

  return (
    <Card className="mapa-sidebar">
      <CardHeader className="mapa-sidebar__header">
        <CardTitle className="mapa-sidebar__title">
          <span aria-hidden>🗺️</span> Asignación DSP — Alicante
        </CardTitle>
        <p className="mapa-sidebar__subtitle">
          Coroplético por código postal · Fuente: CNIG + datos internos
        </p>
      </CardHeader>
      <CardContent className="mapa-sidebar__content">
        <div className="mapa-sidebar__stats">
          <div className="mapa-sidebar__stat">
            <div className="mapa-sidebar__stat-v">{totalCp}</div>
            <div className="mapa-sidebar__stat-l">Códigos postales</div>
          </div>
          <div className="mapa-sidebar__stat">
            <div className="mapa-sidebar__stat-v">{fmtVol(totalVolumen)}</div>
            <div className="mapa-sidebar__stat-l">Volumen diario</div>
          </div>
        </div>

        <div className="mapa-sidebar__section-title">Empresas (DSP)</div>
        <div className="mapa-sidebar__filter-bar" role="tablist" aria-label="Filtro SLA">
          {SLA_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              role="tab"
              aria-selected={slaFilter === chip.id}
              data-filter={chip.id}
              onClick={() => onChangeSla(chip.id)}
              className={cn(
                "mapa-sidebar__chip",
                slaFilter === chip.id && "mapa-sidebar__chip--active",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="mapa-sidebar__legend">
          {sortedDsps.map((dsp) => {
            const vol = perDsp[dsp] ?? 0;
            const pct = totalVolumen ? ((vol / totalVolumen) * 100).toFixed(1) : "0.0";
            const isActive = activeDsp === dsp;
            const isOff = activeDsp !== null && !isActive;
            return (
              <button
                key={dsp}
                type="button"
                onClick={() => onToggleDsp(dsp)}
                aria-pressed={isActive}
                className={cn(
                  "mapa-sidebar__legend-item",
                  isOff && "mapa-sidebar__legend-item--off",
                )}
              >
                <span
                  className="mapa-sidebar__legend-dot"
                  style={{ background: DSP_COLORS[dsp] ?? "#9ca3af" }}
                />
                <span className="mapa-sidebar__legend-label">{dsp}</span>
                <span className="mapa-sidebar__legend-vol">
                  <span className="mapa-sidebar__legend-pct">{pct}%</span>
                  {fmtVol(vol)} vol
                </span>
              </button>
            );
          })}
        </div>

        <div className="mapa-sidebar__tip">
          💡 <b>Tip:</b> Clic en una empresa para resaltarla sola. Los polígonos están coloreados
          por DSP asignado. Pasa el ratón por encima para resaltar el borde.
        </div>
      </CardContent>
    </Card>
  );
}
