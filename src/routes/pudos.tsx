import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import XLSXStyle from "xlsx-js-style";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Download, MapPin, AlertTriangle } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useEpodDates } from "@/lib/use-epod-dates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusIndicator } from "@/components/indicator";

export const Route = createFileRoute("/pudos")({
  component: () => (
    <RequireAuth path="/pudos">
      <PudosPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — PUDOs" },
      {
        name: "description",
        content: "Gap de distancia GPS entre la ubicación registrada de cada punto PUDO y dónde se marcó la entrega real.",
      },
    ],
  }),
});

const ALERT_THRESHOLD_M = 250;
const PAGE_SIZE = 1000;

type PudoLinea = {
  waybill: string | null;
  lp_no: string;
  pop_station_id: string | null;
  direccion: string | null;
  cp: string | null;
  latitude: number | null;
  longitude: number | null;
  entrega_real_latitude: number | null;
  entrega_real_longitude: number | null;
};

type Paquete = {
  waybill: string | null;
  lp_no: string;
  cp: string | null;
  gap: number | null; // metros; null = sin datos de ubicación real
  alerta: boolean;
};

type PuntoPudo = {
  key: string; // pop_station_id, o "sin-punto"
  direccion: string;
  paquetes: Paquete[];
  nEntregados: number;
  nAlertas: number;
  nSinDatos: number;
  gapPromedio: number | null;
  gapMax: number | null;
};

// Fórmula haversine — distancia en metros entre dos coordenadas GPS.
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function fetchPudoLineas(hubId: string, fecha: string): Promise<PudoLinea[]> {
  const { count, error: countErr } = await supabase
    .from("epod_lineas")
    .select("id", { count: "exact", head: true })
    .eq("hub_id", hubId)
    .eq("fecha", fecha)
    .eq("tipo_norm", "PUDO")
    .eq("estado", "Entregado");
  if (countErr) throw countErr;
  const total = count ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => {
      const from = i * PAGE_SIZE;
      return supabase
        .from("epod_lineas")
        .select("waybill, lp_no, pop_station_id, direccion, cp, latitude, longitude, entrega_real_latitude, entrega_real_longitude")
        .eq("hub_id", hubId)
        .eq("fecha", fecha)
        .eq("tipo_norm", "PUDO")
        .eq("estado", "Entregado")
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
    }),
  );
  const out: PudoLinea[] = [];
  for (const { data, error: qErr } of pages) {
    if (qErr) throw qErr;
    out.push(...((data ?? []) as PudoLinea[]));
  }
  return out;
}

function computePuntos(lineas: PudoLinea[]): PuntoPudo[] {
  const grupos = new Map<string, PudoLinea[]>();
  for (const l of lineas) {
    const key = l.pop_station_id?.trim() || "sin-punto";
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(l);
  }

  const puntos: PuntoPudo[] = [];
  for (const [key, rows] of grupos) {
    const direccion = rows.find((r) => r.direccion)?.direccion ?? (key === "sin-punto" ? "Sin punto identificado" : "—");
    const paquetes: Paquete[] = rows.map((r) => {
      const tieneAmbas =
        r.latitude != null && r.longitude != null && r.entrega_real_latitude != null && r.entrega_real_longitude != null;
      const gap = tieneAmbas
        ? haversineMeters(r.latitude as number, r.longitude as number, r.entrega_real_latitude as number, r.entrega_real_longitude as number)
        : null;
      return {
        waybill: r.waybill,
        lp_no: r.lp_no,
        cp: r.cp,
        gap,
        alerta: gap != null && gap > ALERT_THRESHOLD_M,
      };
    });
    const conGap = paquetes.filter((p) => p.gap != null).map((p) => p.gap as number);
    puntos.push({
      key,
      direccion,
      paquetes,
      nEntregados: paquetes.length,
      nAlertas: paquetes.filter((p) => p.alerta).length,
      nSinDatos: paquetes.filter((p) => p.gap == null).length,
      gapPromedio: conGap.length > 0 ? conGap.reduce((a, b) => a + b, 0) / conGap.length : null,
      gapMax: conGap.length > 0 ? Math.max(...conGap) : null,
    });
  }
  puntos.sort((a, b) => b.nAlertas - a.nAlertas || b.nEntregados - a.nEntregados);
  return puntos;
}

function exportPudosXlsx(puntos: PuntoPudo[], hubMarca: string, fecha: string) {
  const headers = ["Punto PUDO", "Dirección", "Waybill", "CP", "Gap (m)", "Alerta (>250m)"];
  const aoa: (string | number)[][] = [headers];
  for (const p of puntos) {
    for (const paq of p.paquetes) {
      aoa.push([
        p.key === "sin-punto" ? "Sin punto identificado" : p.key,
        p.direccion,
        paq.waybill ?? paq.lp_no,
        paq.cp ?? "",
        paq.gap != null ? Number(paq.gap.toFixed(1)) : "",
        paq.gap == null ? "Sin datos" : paq.alerta ? "Sí" : "No",
      ]);
    }
  }
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
  const headerStyle = {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "111111" } },
  };
  const range = XLSXStyle.utils.decode_range(ws["!ref"] as string);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSXStyle.utils.encode_cell({ r: 0, c })];
    if (cell) cell.s = headerStyle;
  }
  // Filas de alerta en rojo.
  let rowIdx = 1;
  for (const p of puntos) {
    for (const paq of p.paquetes) {
      if (paq.alerta) {
        for (let c = 0; c < headers.length; c++) {
          const cell = ws[XLSXStyle.utils.encode_cell({ r: rowIdx, c })];
          if (cell) cell.s = { fill: { patternType: "solid", fgColor: { rgb: "FEE2E2" } }, font: { color: { rgb: "991B1B" } } };
        }
      }
      rowIdx++;
    }
  }
  ws["!cols"] = [{ wch: 22 }, { wch: 36 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 14 }];
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, "PUDOs");
  const buf = XLSXStyle.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `PUDOs_${hubMarca.replace(/[^a-z0-9]+/gi, "_")}_${fecha}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function PudosPage() {
  const { selectedHub } = useAuth();
  const { data: dates, isLoading: datesLoading } = useEpodDates(selectedHub?.id ?? null);
  const [fecha, setFecha] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [puntos, setPuntos] = useState<PuntoPudo[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setFecha(dates && dates.length > 0 ? dates[0] : null);
  }, [dates]);

  useEffect(() => {
    const run = async () => {
      if (!selectedHub || !fecha) {
        setPuntos(null);
        return;
      }
      setLoading(true);
      try {
        const lineas = await fetchPudoLineas(selectedHub.id, fecha);
        setPuntos(computePuntos(lineas));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error cargando PUDOs");
        setPuntos(null);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [selectedHub?.id, fecha]);

  const totales = useMemo(() => {
    if (!puntos) return { total: 0, alertas: 0, sinDatos: 0, pct: 0 };
    const total = puntos.reduce((a, p) => a + p.nEntregados, 0);
    const alertas = puntos.reduce((a, p) => a + p.nAlertas, 0);
    const sinDatos = puntos.reduce((a, p) => a + p.nSinDatos, 0);
    return { total, alertas, sinDatos, pct: total > 0 ? (alertas / total) * 100 : 0 };
  }, [puntos]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="PUDOs" />
      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-5xl mx-auto space-y-8">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">PUDOs</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Gap de distancia entre la ubicación registrada de cada punto PUDO y dónde se marcó la entrega real. Alerta a partir de {ALERT_THRESHOLD_M} m.
            </p>
          </header>

          {!selectedHub ? (
            <div className="px-4 py-6 border-l-2 border-destructive bg-destructive/10 text-destructive text-xs rounded-r">
              Selecciona un hub en la barra superior para empezar.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[200px]">
                  <label className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Día</label>
                  <Select value={fecha ?? undefined} onValueChange={setFecha} disabled={datesLoading || !dates || dates.length === 0}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={datesLoading ? "Cargando…" : "Sin ePOD para este hub"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(dates ?? []).map((d) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {puntos && puntos.length > 0 && selectedHub && fecha && (
                  <Button variant="outline" onClick={() => exportPudosXlsx(puntos, selectedHub.marca, fecha)} className="gap-2">
                    <Download className="size-3.5" /> Exportar Excel
                  </Button>
                )}
              </div>

              {loading ? (
                <p className="text-muted-foreground text-xs">Cargando…</p>
              ) : !puntos || puntos.length === 0 ? (
                <Card className="shadow-none">
                  <CardContent className="py-6 text-sm text-muted-foreground">
                    Sin paquetes PUDO entregados en este día para este hub.
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Card className="shadow-none">
                      <CardHeader>
                        <CardTitle className="font-normal text-muted-foreground text-xs">Paquetes PUDO del día</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="font-semibold text-2xl tabular-nums">{totales.total}</p>
                      </CardContent>
                    </Card>
                    <Card className="shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 font-normal text-muted-foreground text-xs">
                          <StatusIndicator color="rose" pulse={false} />
                          Alertas (&gt;{ALERT_THRESHOLD_M}m)
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="font-semibold text-2xl tabular-nums">{totales.alertas}</p>
                        <p className="text-xs text-muted-foreground mt-1">{totales.pct.toFixed(1)}% del total</p>
                      </CardContent>
                    </Card>
                    <Card className="shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 font-normal text-muted-foreground text-xs">
                          <StatusIndicator color="amber" pulse={false} />
                          Sin datos de ubicación real
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="font-semibold text-2xl tabular-nums">{totales.sinDatos}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="shadow-none overflow-hidden">
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted">
                              <th className="px-4 py-2.5 w-8" />
                              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Punto PUDO</th>
                              <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Dirección</th>
                              <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">N° Entregados</th>
                              <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">N° Alerta</th>
                              <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Gap Promedio</th>
                              <th className="text-right px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Gap Máximo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {puntos.map((p) => (
                              <Fragment key={p.key}>
                                <tr
                                  onClick={() => toggle(p.key)}
                                  className={`border-t border-border cursor-pointer hover:bg-accent/40 transition-colors ${p.nAlertas > 0 ? "bg-destructive/5" : ""}`}
                                >
                                  <td className="px-4 py-2 text-muted-foreground">
                                    {expanded.has(p.key) ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                  </td>
                                  <td className="px-4 py-2 text-foreground whitespace-nowrap font-medium">
                                    <span className="inline-flex items-center gap-1.5">
                                      <MapPin className="size-3.5 text-muted-foreground" />
                                      {p.key === "sin-punto" ? "Sin identificar" : p.key}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 text-foreground max-w-[280px] truncate" title={p.direccion}>{p.direccion}</td>
                                  <td className="px-4 py-2 text-right tabular-nums text-foreground">{p.nEntregados}</td>
                                  <td className="px-4 py-2 text-right tabular-nums">
                                    {p.nAlertas > 0 ? (
                                      <span className="inline-flex items-center gap-1 text-destructive font-medium">
                                        <AlertTriangle className="size-3" /> {p.nAlertas}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">0</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-right tabular-nums text-foreground">
                                    {p.gapPromedio != null ? `${p.gapPromedio.toFixed(0)} m` : "—"}
                                  </td>
                                  <td className="px-4 py-2 text-right tabular-nums text-foreground">
                                    {p.gapMax != null ? `${p.gapMax.toFixed(0)} m` : "—"}
                                  </td>
                                </tr>
                                {expanded.has(p.key) && (
                                  <tr key={`${p.key}-detalle`}>
                                    <td colSpan={7} className="p-0 bg-muted/40">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                            <th className="text-left pl-12 pr-4 py-2">Waybill</th>
                                            <th className="text-left px-4 py-2">CP</th>
                                            <th className="text-right px-4 py-2">Gap</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {p.paquetes.map((paq) => (
                                            <tr
                                              key={paq.lp_no}
                                              className={paq.alerta ? "bg-destructive/10 text-destructive" : "text-foreground"}
                                            >
                                              <td className="pl-12 pr-4 py-1.5 whitespace-nowrap">{paq.waybill ?? paq.lp_no}</td>
                                              <td className="px-4 py-1.5">{paq.cp ?? "—"}</td>
                                              <td className="px-4 py-1.5 text-right tabular-nums">
                                                {paq.gap != null ? `${paq.gap.toFixed(0)} m` : (
                                                  <span className="text-muted-foreground">Sin datos</span>
                                                )}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
