import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Download } from "lucide-react";
import XLSXStyle from "xlsx-js-style";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { REGLAS, useRiesgo, type Grupo, type PaqueteRiesgo } from "@/lib/kpis-riesgo";

const GRUPO_LABEL: Record<Grupo, string> = { roto: "Ya rotos", hoy: "Rompen hoy", manana: "Rompen mañana" };

const fmt = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
    : "—";

function horasTxt(h: number) {
  return h < 0 ? `roto hace ${Math.abs(h).toFixed(1)} h` : `faltan ${h.toFixed(1)} h`;
}
function tipoTxt(t: string | null) {
  const v = (t ?? "").toUpperCase();
  if (v === "PUDO") return "PUDO";
  if (v === "TO_LOCKER") return "Locker";
  return "Domicilio";
}

function exportXlsx(rows: PaqueteRiesgo[], hubMarca: string) {
  const headers = ["LP/Waybill", "Origen", "Métrica", "Grupo", "Inbound", "Límite", "Horas", "Último estado", "Intentos fallidos", "Último motivo", "Tipo", "Punto PUDO", "CP", "Ciudad", "Dirección", "Driver"];
  const aoa: (string | number)[][] = [headers];
  for (const p of rows) {
    aoa.push([p.waybill || p.id, p.origen, p.metrica, GRUPO_LABEL[p.grupo], fmt(p.inbound_at), fmt(p.limite), p.horas, p.ultimo_estado ?? "", p.intentos, p.ultimo_motivo ?? "", tipoTxt(p.tipo), p.pudo ?? "", p.cp ?? "", p.ciudad ?? "", p.direccion ?? "", p.driver ?? ""]);
  }
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
  for (let c = 0; c < headers.length; c++) {
    const cell = (ws as Record<string, { s?: unknown }>)[XLSXStyle.utils.encode_cell({ r: 0, c })];
    if (cell) cell.s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { patternType: "solid", fgColor: { rgb: "111111" } } };
  }
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, ws, "Riesgo");
  const buf = XLSXStyle.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `paquetes_en_riesgo_${hubMarca}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function KpisRiesgoTab({ hubId, hubMarca }: { hubId: string | null; hubMarca: string }) {
  const { data, isLoading, isError } = useRiesgo(hubId);
  const [grupo, setGrupo] = useState<"all" | Grupo>("all");
  const [origen, setOrigen] = useState<"all" | "Local" | "China">("all");
  const [cp, setCp] = useState("all");

  const paquetes = data?.paquetes ?? [];
  const cps = useMemo(() => [...new Set(paquetes.map((p) => p.cp).filter(Boolean) as string[])].sort(), [paquetes]);
  const filtrados = paquetes.filter(
    (p) => (grupo === "all" || p.grupo === grupo) && (origen === "all" || p.origen === origen) && (cp === "all" || p.cp === cp),
  );
  const count = (g: Grupo, m: "CD5" | "CD9") => paquetes.filter((p) => p.grupo === g && p.metrica === m).length;

  if (!hubId) return <p className="text-sm text-muted-foreground">Selecciona un hub.</p>;
  if (isLoading) return <p className="text-sm text-muted-foreground">Calculando…</p>;
  if (isError || !data) return <p className="text-sm text-destructive">Error cargando paquetes en riesgo.</p>;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Solo paquetes en reparto hoy: recibidos por el repartidor, fallados, entregados o cancelados en el día de hoy.
      </p>
      {data.sin_horas && (
        <div className="flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <AlertTriangle className="size-4 text-warn" />
          Vuelve a subir los ePOD para medir por horas.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(["roto", "hoy", "manana"] as Grupo[]).map((g) => (
          <Card key={g} className={g === "roto" ? "border-destructive/40" : undefined}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{GRUPO_LABEL[g]}</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-6">
              <div><div className="text-2xl font-semibold">{count(g, "CD5")}</div><div className="text-xs text-muted-foreground">CD5</div></div>
              <div><div className="text-2xl font-semibold">{count(g, "CD9")}</div><div className="text-xs text-muted-foreground">CD9</div></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0">
          <CardTitle className="mr-auto text-base">Paquetes ({filtrados.length})</CardTitle>
          <Select value={grupo} onValueChange={(v) => setGrupo(v as typeof grupo)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los grupos</SelectItem>
              <SelectItem value="roto">Ya rotos</SelectItem>
              <SelectItem value="hoy">Rompen hoy</SelectItem>
              <SelectItem value="manana">Rompen mañana</SelectItem>
            </SelectContent>
          </Select>
          <Select value={origen} onValueChange={(v) => setOrigen(v as typeof origen)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo origen</SelectItem>
              <SelectItem value="Local">Local</SelectItem>
              <SelectItem value="China">China</SelectItem>
            </SelectContent>
          </Select>
          <Select value={cp} onValueChange={setCp}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los CP</SelectItem>
              {cps.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => exportXlsx(filtrados, hubMarca)} disabled={filtrados.length === 0}>
            <Download className="size-4" /> Excel
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {["LP/Waybill", "Origen", "Métrica", "Inbound", "Límite", "Horas", "Último estado", "Intentos", "Último motivo", "Tipo", "PUDO", "CP", "Ciudad", "Dirección", "Driver"].map((h) => (
                  <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.length === 0 ? (
                <TableRow><TableCell colSpan={15} className="text-center text-muted-foreground">Sin paquetes en riesgo.</TableCell></TableRow>
              ) : (
                filtrados.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.waybill || p.id}</TableCell>
                    <TableCell>{p.origen}</TableCell>
                    <TableCell><Badge variant={p.metrica === "CD9" ? "destructive" : "outline"}>{p.metrica}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap">{fmt(p.inbound_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmt(p.limite)}</TableCell>
                    <TableCell className={`whitespace-nowrap ${p.horas < 0 ? "text-destructive font-medium" : ""}`}>{horasTxt(p.horas)}</TableCell>
                    <TableCell>{p.ultimo_estado ?? "—"}</TableCell>
                    <TableCell>{p.intentos}</TableCell>
                    <TableCell className="max-w-48 truncate">{p.ultimo_motivo ?? "—"}</TableCell>
                    <TableCell>{tipoTxt(p.tipo)}</TableCell>
                    <TableCell>{p.pudo ?? "—"}</TableCell>
                    <TableCell>{p.cp ?? "—"}</TableCell>
                    <TableCell>{p.ciudad ?? "—"}</TableCell>
                    <TableCell className="max-w-56 truncate">{p.direccion ?? "—"}</TableCell>
                    <TableCell>{p.driver ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Collapsible>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer flex flex-row items-center space-y-0">
              <CardTitle className="mr-auto text-base">Fuera de target ({data.fuera_target.length})</CardTitle>
              <ChevronDown className="size-4" />
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {["LP", "Regla", "Origen", "Inbound", "Último estado", "Último motivo", "CP", "Driver"].map((h) => <TableHead key={h}>{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.fuera_target.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-mono text-xs">{f.id}</TableCell>
                      <TableCell title={REGLAS[f.regla]}><Badge variant="outline">{f.regla}</Badge> <span className="text-xs text-muted-foreground">{REGLAS[f.regla]}</span></TableCell>
                      <TableCell>{f.origen}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmt(f.inbound_at)}</TableCell>
                      <TableCell>{f.ultimo_estado ?? "—"}</TableCell>
                      <TableCell className="max-w-48 truncate">{f.ultimo_motivo ?? "—"}</TableCell>
                      <TableCell>{f.cp ?? "—"}</TableCell>
                      <TableCell>{f.driver ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
