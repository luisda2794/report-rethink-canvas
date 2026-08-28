import { AlertTriangle, Download, Info } from "lucide-react";
import XLSXStyle from "xlsx-js-style";
import { Button } from "@/components/ui/button";
import { useRiesgo, type PaqueteEnRiesgo } from "@/lib/kpis-riesgo";

// Mismos umbrales/colores que ya usa /reportes/paquetes-en-riesgo, para que
// los dos reportes de riesgo se lean igual aunque el criterio de filtro sea
// distinto (este agrega 3+ intentos fallidos, el otro no).
function riskLevel(d: number): "critico" | "alto" | "medio" {
  if (d >= 10) return "critico";
  if (d >= 7) return "alto";
  return "medio";
}
function riskColors(level: "critico" | "alto" | "medio") {
  if (level === "critico") return { cell: "bg-destructive text-destructive-foreground", hex: "B91C1C", fontHex: "FFFFFF" };
  if (level === "alto") return { cell: "bg-rose-300 text-red-900", hex: "FDA4AF", fontHex: "7F1D1D" };
  return { cell: "bg-warn text-foreground", hex: "F59E0B", fontHex: "FFFFFF" };
}

function exportXlsx(paquetes: PaqueteEnRiesgo[], hubMarca: string, fecha: string) {
  const headers = ["Waybill/LP", "Días desde Inbound", "Intentos Fallidos", "Última Incidencia", "CP", "Dirección", "Driver"];
  const aoa: (string | number)[][] = [headers];
  for (const p of paquetes) {
    aoa.push([p.id, p.diasDesdeInbound, p.intentosFallidos, p.ultimaIncidencia, p.cp || "—", p.direccion || "—", p.driver || "—"]);
  }
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
  const headerStyle = {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "111111" } },
    alignment: { horizontal: "center", vertical: "center" },
  };
  for (let c = 0; c < headers.length; c++) {
    const ref = XLSXStyle.utils.encode_cell({ r: 0, c });
    const cell = (ws as Record<string, unknown>)[ref] as { s?: unknown } | undefined;
    if (cell) cell.s = headerStyle;
  }
  for (let i = 0; i < paquetes.length; i++) {
    const { hex, fontHex } = riskColors(riskLevel(paquetes[i].diasDesdeInbound));
    const ref = XLSXStyle.utils.encode_cell({ r: i + 1, c: 1 });
    const cell = (ws as Record<string, unknown>)[ref] as { s?: unknown } | undefined;
    if (cell) cell.s = { font: { bold: true, color: { rgb: fontHex } }, fill: { patternType: "solid", fgColor: { rgb: hex } }, alignment: { horizontal: "center" } };
  }
  ws["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 32 }, { wch: 8 }, { wch: 40 }, { wch: 24 }];
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, "Riesgo");
  const buf = XLSXStyle.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `paquetes_en_riesgo_${hubMarca}_${fecha}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function KpisRiesgoTab({ hubId, hubMarca }: { hubId: string | null; hubMarca: string }) {
  const { data, isLoading, isError } = useRiesgo(hubId);

  if (!hubId) return <p className="text-sm text-muted-foreground">Selecciona un hub para ver sus paquetes en riesgo.</p>;
  if (isError) return <p className="text-sm text-destructive">No se pudieron cargar los paquetes en riesgo.</p>;
  if (isLoading) return <p className="text-sm text-muted-foreground">Calculando…</p>;

  const paquetes = data?.paquetes ?? [];
  const fecha = data?.fechaEvaluada;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {fecha ? (
            <>
              <span className="text-foreground font-semibold">{paquetes.length}</span> paquete(s) en riesgo al{" "}
              <span className="text-foreground font-medium">{fecha}</span> — en reparto, 3+ intentos fallidos, 5+ días desde inbound.
            </>
          ) : (
            "Sin datos para este hub."
          )}
        </p>
        <Button onClick={() => fecha && exportXlsx(paquetes, hubMarca, fecha)} disabled={paquetes.length === 0} size="sm" className="gap-2">
          <Download className="size-3.5" /> Exportar Excel
        </Button>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground/80">
        <Info className="size-3.5 mt-0.5 shrink-0" />
        Teléfono del cliente no disponible: <code className="text-[11px]">epod_lineas</code> no guarda esa columna hoy — el ePOD la trae
        como "Teléfono de contacto", pero el parser de /epod no la captura todavía (<code className="text-[11px]">contacto</code> es el
        nombre del contacto, no el teléfono).
      </p>

      {paquetes.length === 0 ? (
        <div className="p-6 bg-card border rounded-lg text-sm text-foreground">Sin paquetes en riesgo con este criterio ✓</div>
      ) : (
        <div className="bg-card border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2.5">Waybill/LP</th>
                <th className="text-center px-3 py-2.5">Días desde Inbound</th>
                <th className="text-center px-3 py-2.5">Intentos Fallidos</th>
                <th className="text-left px-3 py-2.5">Última Incidencia</th>
                <th className="text-left px-3 py-2.5">CP</th>
                <th className="text-left px-3 py-2.5">Dirección</th>
                <th className="text-left px-3 py-2.5">Driver</th>
                <th className="text-left px-3 py-2.5">Teléfono</th>
              </tr>
            </thead>
            <tbody>
              {paquetes.map((p) => {
                const level = riskLevel(p.diasDesdeInbound);
                const colors = riskColors(level);
                return (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">{p.id}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold tabular-nums ${colors.cell}`}>
                        {level === "critico" && <AlertTriangle className="size-3" />}
                        {p.diasDesdeInbound}d
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-foreground tabular-nums">{p.intentosFallidos}</td>
                    <td className="px-3 py-2 text-foreground max-w-[280px] truncate" title={p.ultimaIncidencia}>{p.ultimaIncidencia}</td>
                    <td className="px-3 py-2 text-foreground">{p.cp || "—"}</td>
                    <td className="px-3 py-2 text-foreground max-w-[280px] truncate" title={p.direccion}>{p.direccion || "—"}</td>
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">{p.driver || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
