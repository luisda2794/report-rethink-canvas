import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Upload, FileSpreadsheet, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HubCombobox } from "@/components/HubCombobox";
import { getAllHubs, deleteEpodData, renameHub, parseEpodFile, saveEpodData, type EpodMetadata } from "@/lib/epodStore";

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const isToday = d.toDateString() === new Date().toDateString();
  return isToday ? `hoy ${time}` : `${d.toLocaleDateString("es-ES")} ${time}`;
}

export function LocalEpodTab() {
  const [hubInput, setHubInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hubsList, setHubsList] = useState<EpodMetadata[]>([]);
  const [renamingHub, setRenamingHub] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshHubs = () => {
    getAllHubs().then(setHubsList).catch(() => { /* ignore */ });
  };

  useEffect(() => {
    refreshHubs();
  }, []);

  const handleFile = async (f: File | null) => {
    setFile(f);
    setError(null);
    if (!f) return;
    const hub = hubInput.trim();
    if (!hub) {
      setError("Escribe o elige un hub antes de subir el archivo.");
      setFile(null);
      return;
    }
    setLoading(true);
    try {
      const parsed = await parseEpodFile(f);
      await saveEpodData(hub, parsed.rows, {
        fileName: f.name,
        rowCount: parsed.rows.length,
        minDate: parsed.minDate,
        maxDate: parsed.maxDate,
        detectedFields: parsed.detectedFields,
      });
      refreshHubs();
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error leyendo el archivo.");
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (hub: string) => {
    if (!confirm(`¿Eliminar los datos cargados de "${hub}"? Esta acción no se puede deshacer.`)) return;
    await deleteEpodData(hub);
    refreshHubs();
  };

  const handleRenameSave = async (oldName: string) => {
    const next = renameValue.trim();
    if (!next || next === oldName) {
      setRenamingHub(null);
      return;
    }
    try {
      await renameHub(oldName, next);
      setRenamingHub(null);
      refreshHubs();
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo renombrar el hub.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">Subir ePOD para un hub</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-muted-foreground">Hub</label>
            <HubCombobox value={hubInput} onChange={setHubInput} className="mt-1 max-w-xs" />
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            className={`p-5 bg-card border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="size-6 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{file.name}</div>
                  <div className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleFile(null);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  aria-label="Quitar archivo"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-muted-foreground">
                <Upload className="size-6 text-primary" />
                <div>
                  <div className="text-sm font-semibold text-foreground">Sube el Excel del ePOD (Cainiao)</div>
                  <div className="text-xs">Reemplaza los datos guardados de este hub · .xlsx, .xls</div>
                </div>
              </div>
            )}
          </div>
          {loading && <p className="text-xs text-muted-foreground">Procesando…</p>}
          {error && (
            <p className="text-destructive text-xs flex items-start gap-1.5">
              <AlertCircle className="size-3 mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm">Hubs con datos cargados</CardTitle>
        </CardHeader>
        <CardContent>
          {hubsList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay hubs con datos cargados.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hub</TableHead>
                    <TableHead>Última actualización</TableHead>
                    <TableHead>Rango de fechas</TableHead>
                    <TableHead className="text-right">N° de filas</TableHead>
                    <TableHead className="w-[320px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hubsList.map((h) => (
                    <TableRow key={h.hub}>
                      <TableCell>
                        {renamingHub === h.hub ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              className="h-8 w-36"
                              autoFocus
                            />
                            <Button size="sm" onClick={() => void handleRenameSave(h.hub)}>Guardar</Button>
                            <Button size="sm" variant="outline" onClick={() => setRenamingHub(null)}>Cancelar</Button>
                          </div>
                        ) : (
                          <span className="font-semibold text-foreground">{h.hub}</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatUpdatedAt(h.uploadedAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {h.minDate ?? "—"} → {h.maxDate ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{h.rowCount.toLocaleString("es-ES")}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Link to="/reportes">
                            <Button size="sm" variant="outline">Ver reportes</Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setRenamingHub(h.hub); setRenameValue(h.hub); }}
                          >
                            Renombrar
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => void handleDelete(h.hub)}>
                            Eliminar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
