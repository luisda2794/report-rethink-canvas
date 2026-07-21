import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  AlertTriangle,
  Check,
  Loader2,
  AlertCircle,
  Upload,
  FileSpreadsheet,
  X,
  Database,
  Copy,
  Sparkles,
  Users,
} from "lucide-react";
import * as XLSX from "xlsx";
import { format, subDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RequireAuth } from "@/components/RequireAuth";
import { ReportCard } from "@/components/ReportCard";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";


export const Route = createFileRoute("/reportes")({
  component: () => (
    <RequireAuth path="/reportes">
      <ReportesPage />
    </RequireAuth>
  ),
  errorComponent: ({ error, reset }) => (
    <div className="p-8 max-w-xl mx-auto space-y-3">
      <h2 className="text-lg font-semibold">Algo falló al cargar reportes</h2>
      <pre className="text-xs bg-muted p-3 rounded overflow-auto">{String(error?.message ?? error)}</pre>
      <Button onClick={reset} size="sm">Reintentar</Button>
    </div>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Reportes" },
      {
        name: "description",
        content:
          "Genera reportes (DSR, CD4, CD6, OOH, ROP, PFM) subiendo el archivo de Cainiao.",
      },
    ],
  }),
});

const API_BASE = "/api/reportes";

type ReportState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done" }
  | { kind: "error"; message: string };

type Reporte = {
  id: string;
  code: string;
  name: string;
  desc: string;
  freq: "DIARIO" | "SEMANAL";
  target?: string;
};

const TABS = {
  carretera: {
    label: "En Carretera",
    reportes: [
      { id: "riesgo", code: "ROP", name: "Riesgo Operativo", desc: "En reparto hoy con 3+ incidencias previas.", freq: "DIARIO" as const, target: "CRÍTICO" },
      { id: "preflow", code: "PFM", name: "Pre Flow Meeting", desc: "PUDO por driver · Puntos y paquetes de hoy.", freq: "DIARIO" as const, target: "OPERATIVO" },
    ],
  },
  kpis: {
    label: "KPIs Flota",
    reportes: [
      { id: "dsr", code: "DSR", name: "Tasa de entrega", desc: "Éxito diario por driver y CP · Solo L–V.", freq: "SEMANAL" as const, target: "TGT ≥ 90%" },
      { id: "cd4", code: "CD4", name: "Alerta preventiva", desc: "Paquetes en riesgo antes de D+4.", freq: "DIARIO" as const, target: "PREVENTIVO" },
      { id: "cd6", code: "CD6", name: "Plazo crítico", desc: "Entrega antes D+6 · Target 99.5%.", freq: "DIARIO" as const, target: "TGT ≥ 99.5%" },
      { id: "ooh", code: "OOH", name: "PUDO / Out of Home", desc: "Uso de puntos de recogida semanal.", freq: "SEMANAL" as const, target: "TGT ≥ 95%" },
    ],
  },
} as const;

// ARCHIVADO: bloque legado de generación de reportes (Usar datos guardados,
// subir Excel de Cainiao y pestañas ROP · PFM · DSR · CD4 · CD6 · OOH).
// Reemplazado en la UI por las tarjetas dedicadas (Paquetes en Riesgo, Flow
// Meeting, Duplicados, Mapas Provincia). Se conserva el código por si hace
// falta reactivarlo: cambiar a `true`.
const SHOW_LEGACY_REPORT_TOOLS = false;

function filenameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const m = /filename\*=UTF-8''([^;]+)/i.exec(header) || /filename="?([^";]+)"?/i.exec(header);
  if (!m) return fallback;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

function isoToday() { return new Date().toISOString().slice(0, 10); }

function ReportesPage() {
  const { selectedHub } = useAuth();
  const [tab, setTab] = useState<keyof typeof TABS>("carretera");
  const [states, setStates] = useState<Record<string, ReportState>>({});
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(() => format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(() => format(new Date(), "yyyy-MM-dd"));

  const onPickFile = (f: File | null) => {
    setFile(f);
    setStates({});
    setGenError(null);
  };

  // Al cambiar de hub, limpiar el archivo cargado/generado para forzar
  // regenerar con los datos del hub actualmente seleccionado.
  useEffect(() => {
    setFile(null);
    setStates({});
    setGenError(null);
  }, [selectedHub?.id]);

  const generarDesdeBase = async () => {
    if (!selectedHub) return;
    setGenLoading(true);
    setGenError(null);
    try {
      const CAINIAO_HEADERS = [
        "Número de Waybill","LP No.","Fecha de la tarea","Sitiocode","Plan de envíocode",
        "Estado de la Tarea","Tipo de pedido","Tipo de Entrega","Nombre del Repartidor","Nombre de DSP",
        "Orden de grupo de tareas","La primera clasificación del número de la bolsa grande","País receptor",
        "Área de destino","La ciudad de destino","Código postal","Dirección detallada",
        "Receptor a  latitud","Receptor a  longitud","Entrega real  latitud","Entrega real  longitud",
        "Distancia de brecha de entrega","Contacto","Teléfono de contacto","Teléfono de contacto",
        "Correo","Tiempo de creación","Tiempo de recepción","Tiempo de salida","Comience el tiempo de entrega",
        "Tiempo de Entrega","Método de inicio de sesión","Detalles firmados","Firma","Fotos firmadas",
        "Nombre del firmante","Signo POD","Tiempo del Fracaso de la Entrega","Tipo de Excepción",
        "Detalles de la Excepción","Número de contactos","Última hora de contacto","Advertencia de envío falso",
        "popStationId","ID de tarea","Nombre del esquema","Tipo de paquete","dspActionTime","dspAction",
        "dspOperatorName","hasNewTaskForNextDayDelivery","ocrFailTimes","Motivo de error de programación",
        "returnRemark","badCustomerTag","badZipCodeTag","Punto de conexión","deliveryMode","PUDO address",
        "PUDO Validation Fail","SDSA Failure Reason (PUDO)","Peso (g)","Amplio","Anchura","Alto",
        "eligibleMailbox","Tipo de envío falso","Duración de la llamada de número virtual",
        "Causa de falla de llamada","Tipo de llamada","ocrFailType","Nombre del vendedor","pointBizCode",
        "Nombre del mercado","stationWaveCode","pinCode","hasPinCode","sellerInterception",
        "sellerInterceptionStatus","Vendedor Nombre","Zona","originalPlanTaskDate",
        "Llegando al hub equivocado","Nombre de Hub incorrecto","hasCommercialAreaTag",
        "podCheckManualResult","podCheckManualReason","podCheckTimeManual","podCheckInspector",
      ] as const;

      type CainiaoSourceRow = {
        lp_no: string;
        waybill: string | null;
        driver: string | null;
        fecha: string | null;
        fecha_inbound: string | null;
        cp: string | null;
        direccion: string | null;
        contacto: string | null;
        tipo: string | null;
        estado: string | null;
        pop_station_id: string | null;
      };

      const appendRows = (page: CainiaoSourceRow[]) => {
        for (const r of page) {
          const row: Record<string, string> = {};
          for (const h of CAINIAO_HEADERS) row[h] = "";
          const fechaTs = r.fecha ? `${r.fecha} 08:00:00` : "";
          const inboundTs = r.fecha_inbound ? `${r.fecha_inbound} 08:00:00` : fechaTs;
          row["Número de Waybill"] = r.waybill ?? "";
          row["LP No."] = r.lp_no ?? "";
          row["Fecha de la tarea"] = r.fecha ?? "";
          row["Estado de la Tarea"] = r.estado ?? "";
          row["Tipo de pedido"] = "Entrega";
          row["Tipo de Entrega"] = r.tipo ?? "";
          row["Nombre del Repartidor"] = r.driver ?? "";
          row["Nombre de DSP"] = selectedHub.marca ?? "";
          row["País receptor"] = "ES";
          row["Código postal"] = r.cp ?? "";
          row["Dirección detallada"] = r.direccion ?? "";
          row["Contacto"] = r.contacto ?? "";
          row["Tiempo de creación"] = inboundTs;
          row["Tiempo de recepción"] = inboundTs;
          row["Tiempo de salida"] = fechaTs;
          row["Comience el tiempo de entrega"] = fechaTs;
          row["Tiempo de Entrega"] = r.estado === "Entregado" ? fechaTs : "";
          row["Tiempo del Fracaso de la Entrega"] = r.estado && r.estado !== "Entregado" ? fechaTs : "";
          row["Tipo de Excepción"] = r.estado && !["Entregado", "Driver_received", "Assigned"].includes(r.estado) ? r.estado : "";
          row["popStationId"] = r.pop_station_id ?? "";
          dataRows.push(row);
        }
      };

      const pageSize = 1000;
      const dataRows: Array<Record<string, string>> = [];
      let hasRawEpodLines = false;

      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("epod_lineas")
          .select("lp_no, waybill, driver, fecha, fecha_inbound, cp, direccion, contacto, tipo, estado, pop_station_id")
          .eq("hub_id", selectedHub.id)
          .gte("fecha", fromDate)
          .lte("fecha", toDate)
          .order("fecha", { ascending: true })
          .order("row_index", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = data ?? [];
        if (page.length > 0) hasRawEpodLines = true;
        appendRows(page);
        if (page.length < pageSize) break;
      }

      if (!hasRawEpodLines) {
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await supabase
            .from("entregas")
            .select("lp_no, waybill, driver, fecha, fecha_inbound, cp, direccion, contacto, tipo, estado, pop_station_id")
            .eq("hub_id", selectedHub.id)
            .gte("fecha", fromDate)
            .lte("fecha", toDate)
            .order("fecha", { ascending: true })
            .range(from, from + pageSize - 1);
          if (error) throw error;
          const page = data ?? [];
          appendRows(page);
          if (page.length < pageSize) break;
        }
      }

      if (dataRows.length === 0) {
        setGenError("No hay entregas en ese rango para este hub.");
        setGenLoading(false);
        return;
      }
      const ws = XLSX.utils.json_to_sheet(dataRows, { header: [...CAINIAO_HEADERS] });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const filename = `entregas_${selectedHub.marca}_${fromDate}_${toDate}.xlsx`;
      const generated = new File([blob], filename, { type: blob.type });
      onPickFile(generated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al generar";
      setGenError(msg);
    } finally {
      setGenLoading(false);
    }
  };


  const descargar = async (r: Reporte) => {
    if (!file) return;
    setStates((s) => ({ ...s, [r.id]: { kind: "loading" } }));
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const res = await fetch(`${API_BASE}/${r.id}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        let msg = `Error ${res.status}`;
        try {
          const j = await res.json() as { detail?: unknown; message?: unknown };
          const d = j.detail;
          if (typeof d === "string") msg = d;
          else if (Array.isArray(d)) msg = d.map((it) => (it && typeof it === "object" && "msg" in it ? `${((it as { loc?: unknown[] }).loc ?? []).join(".")}: ${(it as { msg?: string }).msg}` : JSON.stringify(it))).join("; ");
          else if (d && typeof d === "object") msg = JSON.stringify(d);
          else if (typeof j.message === "string") msg = j.message;
        } catch { /* ignore */ }
        setStates((s) => ({ ...s, [r.id]: { kind: "error", message: msg } }));
        return;
      }
      const blob = await res.blob();
      const filename = filenameFromDisposition(res.headers.get("Content-Disposition"), `${r.code}_${isoToday()}.xlsx`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setStates((s) => ({ ...s, [r.id]: { kind: "done" } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error inesperado";
      setStates((s) => ({ ...s, [r.id]: { kind: "error", message: msg } }));
    }
  };

  const reportes = TABS[tab].reportes;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reportes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reportes disponibles para el Hub <HubLabel />.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ReportCard
          to="/reportes/paquetes-en-riesgo"
          icon={AlertTriangle}
          title="Paquetes en Riesgo"
          description="Paquetes en reparto que rompen CD5 (5+ días desde inbound)."
        />
        <ReportCard
          to="/reportes/flow-meeting"
          icon={Users}
          title="Flow Meeting"
          description="Dashboard de la reunión de flujo: KPIs, drivers, CPs e incidencias del día."
        />
        <ReportCard
          to="/duplicados"
          icon={Copy}
          title="Duplicados"
          description="Detección de paquetes duplicados en el ePOD y tasas reales vs. Cainiao."
        />
        <ReportCard
          to="/reportes/super-reporte"
          icon={Sparkles}
          title="Súper Reporte"
          description="Entregas por categoría, CD5/CD13 y CD3 en un solo reporte."
        />
      </div>

      {SHOW_LEGACY_REPORT_TOOLS && (
        <>
          {/* GENERAR DESDE BASE */}
          <Card className="shadow-none">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-3">
                <Database className="size-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">Usar datos guardados</div>
                  <div className="text-xs text-muted-foreground">Genera el Excel desde las entregas ya cargadas en la base</div>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col text-xs text-muted-foreground">
                  Desde
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="mt-1 px-2 py-1.5 text-sm bg-background border rounded"
                  />
                </label>
                <label className="flex flex-col text-xs text-muted-foreground">
                  Hasta
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="mt-1 px-2 py-1.5 text-sm bg-background border rounded"
                  />
                </label>
                <Button onClick={generarDesdeBase} disabled={!selectedHub || genLoading} size="sm" className="gap-2">
                  {genLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Database className="size-3.5" />}
                  {genLoading ? "Generando" : "Usar datos guardados"}
                </Button>
              </div>
              {genError && (
                <p className="mt-2 text-destructive text-xs flex items-start gap-1.5">
                  <AlertCircle className="size-3 mt-0.5 shrink-0" />
                  <span>{genError}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* FILE PICKER (fallback) */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) onPickFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            className={`p-5 bg-card border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "hover:border-primary/50"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="size-6 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onPickFile(null); if (inputRef.current) inputRef.current.value = ""; }}
                  className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                  aria-label="Quitar archivo"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-muted-foreground">
                <Upload className="size-6 text-primary" />
                <div>
                  <div className="text-sm font-semibold text-foreground">O sube el archivo de Cainiao</div>
                  <div className="text-xs">Arrastra aquí o haz clic · .xlsx, .xls, .csv</div>
                </div>
              </div>
            )}
          </div>

          {/* TABS */}
          <div>
            <div className="flex items-center gap-1 border-b mb-6">
              {(Object.keys(TABS) as Array<keyof typeof TABS>).map((key) => {
                const active = tab === key;
                return (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-4 py-3 text-sm font-semibold relative transition-colors ${
                      active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {TABS[key].label}
                    {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary" />}
                  </button>
                );
              })}
              <span className="ml-auto text-xs text-muted-foreground">
                {reportes.length} reportes
              </span>
            </div>

            <div className="space-y-2">
              {reportes.map((r) => {
                const state = states[r.id] ?? { kind: "idle" as const };
                const disabled = !selectedHub || !file || state.kind === "loading";
                return (
                  <Card key={r.id} className="shadow-none flex flex-row items-center gap-5 p-5">
                    <div className="font-semibold text-lg tabular-nums w-14 leading-none">
                      {r.code}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                        <h3 className="font-semibold text-[15px] tracking-tight">{r.name}</h3>
                        <span
                          className={`px-1.5 py-0.5 text-[10px] tracking-wide border rounded ${
                            r.freq === "DIARIO"
                              ? "bg-primary/10 text-primary border-primary/20"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {r.freq}
                        </span>
                        {r.target && (
                          <span className="hidden md:inline text-[10px] text-muted-foreground uppercase">
                            · {r.target}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground text-[13px] truncate">{r.desc}</p>
                      {state.kind === "error" && (
                        <p className="mt-1.5 text-destructive text-xs flex items-start gap-1.5">
                          <AlertCircle className="size-3 mt-0.5 shrink-0" />
                          <span className="break-words">{state.message}</span>
                        </p>
                      )}
                    </div>
                    <Button
                      onClick={() => descargar(r)}
                      disabled={disabled}
                      size="sm"
                      variant={state.kind === "error" ? "destructive" : state.kind === "done" ? "outline" : "default"}
                      className="gap-2 shrink-0"
                    >
                      {state.kind === "loading" && <Loader2 className="size-3.5 animate-spin" />}
                      {state.kind === "done" && <Check className="size-3.5" />}
                      {(state.kind === "idle" || state.kind === "error") && <ArrowDown className="size-3.5" />}
                      {state.kind === "done" ? "Listo" : state.kind === "loading" ? "Generando" : state.kind === "error" ? "Reintentar" : "Descargar"}
                    </Button>
                  </Card>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HubLabel() {
  const { selectedHub } = useAuth();
  return <span className="text-foreground font-semibold">{selectedHub?.marca ?? "—"}</span>;
}
