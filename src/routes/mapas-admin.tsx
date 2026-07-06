import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Upload,
  FileJson,
  FileSpreadsheet,
  Check,
  Trash2,
  AlertCircle,
  MapPin,
} from "lucide-react";
import Papa from "papaparse";

import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { supabase } from "@/integrations/supabase/client";
import {
  listMapaVersions,
  createMapaVersion,
  activateMapaVersion,
  deleteMapaVersion,
  bulkUpsertCpData,
} from "@/lib/mapas.functions";

export const Route = createFileRoute("/mapas-admin")({
  component: () => (
    <RequireAuth path="/mapas-admin">
      <MapasAdminPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Administración de mapas" }] }),
});

type Version = {
  id: string;
  nombre: string;
  geojson_path: string;
  activa: boolean;
  creado_por: string;
  created_at: string;
  updated_at: string;
  cp_count: number;
};

const inputCls =
  "w-full px-3 py-2 text-sm bg-surface border border-hairline rounded-md focus:outline-none focus:ring-2 focus:ring-electric/30 text-foreground placeholder:text-muted-text";

function MapasAdminPage() {
  const listFn = useServerFn(listMapaVersions);
  const createFn = useServerFn(createMapaVersion);
  const activateFn = useServerFn(activateMapaVersion);
  const deleteFn = useServerFn(deleteMapaVersion);
  const upsertFn = useServerFn(bulkUpsertCpData);

  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"versions" | "data">("versions");

  const [newVersionName, setNewVersionName] = useState("");
  const [geojsonFile, setGeojsonFile] = useState<File | null>(null);
  const [busyUpload, setBusyUpload] = useState(false);

  const [csvText, setCsvText] = useState("");
  const [csvRows, setCsvRows] = useState<Record<string, string | number>[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [busyImport, setBusyImport] = useState(false);

  const activeVersion = useMemo(() => versions.find((v) => v.activa), [versions]);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = (await listFn()) as Version[];
      setVersions(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error cargando versiones");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!csvText.trim()) {
      setCsvRows([]);
      setCsvError(null);
      return;
    }
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length) {
          setCsvError(results.errors[0].message);
        } else {
          setCsvError(null);
        }
        setCsvRows(results.data as Record<string, string>[]);
      },
    });
  }, [csvText]);

  const uploadGeojson = async (e: FormEvent) => {
    e.preventDefault();
    if (!geojsonFile || !newVersionName.trim()) {
      toast.error("Selecciona un archivo GeoJSON y escribe un nombre.");
      return;
    }
    setBusyUpload(true);
    try {
      const path = `geojson/${crypto.randomUUID()}.geojson`;
      const { error: upErr } = await supabase.storage.from("mapas").upload(path, geojsonFile, {
        contentType: "application/json",
        upsert: false,
      });
      if (upErr) throw new Error(upErr.message);

      await createFn({ data: { nombre: newVersionName.trim(), geojson_path: path } });
      toast.success("Nueva versión creada y activada");
      setNewVersionName("");
      setGeojsonFile(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error subiendo GeoJSON");
    } finally {
      setBusyUpload(false);
    }
  };

  const onActivate = async (id: string) => {
    try {
      await activateFn({ data: { version_id: id } });
      toast.success("Versión activada");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error activando versión");
    }
  };

  const onDelete = async (v: Version) => {
    if (!confirm(`¿Eliminar la versión "${v.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteFn({ data: { version_id: v.id } });
      toast.success("Versión eliminada");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error eliminando versión");
    }
  };

  const importCsv = async () => {
    if (!activeVersion) {
      toast.error("No hay una versión activa. Crea una versión primero.");
      return;
    }
    if (csvRows.length === 0) {
      toast.error("No hay filas válidas para importar.");
      return;
    }
    const invalid = csvRows.find((r) => !r.cp);
    if (invalid) {
      toast.error("Todas las filas deben tener un código postal (columna 'cp').");
      return;
    }
    setBusyImport(true);
    try {
      const rows = csvRows.map((r) => ({
        cp: String(r.cp),
        dsp: r.dsp ? String(r.dsp) : null,
        hub: r.hub ? String(r.hub) : null,
        sla_teorico: r.sla_teorico ? String(r.sla_teorico) : null,
        sla_fijo: r.sla_fijo ? String(r.sla_fijo) : null,
        volumen: typeof r.volumen === "number" ? r.volumen : null,
      }));
      await upsertFn({ data: { version_id: activeVersion.id, rows } });
      toast.success(`${rows.length} códigos postales importados`);
      setCsvText("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error importando CSV");
    } finally {
      setBusyImport(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Administración de mapas" />
      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-6xl mx-auto">
          <header className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
              <MapPin className="size-5 text-electric" />
              Mapas Provincia
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Gestiona versiones del mapa y actualiza los datos por código postal.
            </p>
          </header>

          <div className="flex items-center gap-1 border-b border-hairline mb-8">
            <TabButton active={activeTab === "versions"} onClick={() => setActiveTab("versions")}>
              Versiones del mapa
            </TabButton>
            <TabButton active={activeTab === "data"} onClick={() => setActiveTab("data")}>
              Datos por CP
            </TabButton>
          </div>

          {loading ? (
            <div className="p-16 text-center text-muted-text font-mono text-xs">
              <Loader2 className="size-5 animate-spin inline-block mr-2" /> Cargando…
            </div>
          ) : activeTab === "versions" ? (
            <VersionsTab
              versions={versions}
              onActivate={onActivate}
              onDelete={onDelete}
              newVersionName={newVersionName}
              setNewVersionName={setNewVersionName}
              geojsonFile={geojsonFile}
              setGeojsonFile={setGeojsonFile}
              onUpload={uploadGeojson}
              busyUpload={busyUpload}
            />
          ) : (
            <DataTab
              activeVersion={activeVersion}
              csvText={csvText}
              setCsvText={setCsvText}
              csvRows={csvRows}
              csvError={csvError}
              onImport={importCsv}
              busyImport={busyImport}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-electric text-electric"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function VersionsTab({
  versions,
  onActivate,
  onDelete,
  newVersionName,
  setNewVersionName,
  geojsonFile,
  setGeojsonFile,
  onUpload,
  busyUpload,
}: {
  versions: Version[];
  onActivate: (id: string) => Promise<void>;
  onDelete: (v: Version) => Promise<void>;
  newVersionName: string;
  setNewVersionName: (s: string) => void;
  geojsonFile: File | null;
  setGeojsonFile: (f: File | null) => void;
  onUpload: (e: FormEvent) => Promise<void>;
  busyUpload: boolean;
}) {
  return (
    <div className="space-y-8">
      <section className="border border-hairline rounded-lg p-6 bg-surface">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Upload className="size-4" /> Subir nueva versión del mapa
        </h2>
        <form onSubmit={onUpload} className="grid md:grid-cols-2 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Nombre de la versión</label>
            <input
              className={inputCls}
              value={newVersionName}
              onChange={(e) => setNewVersionName(e.target.value)}
              placeholder="Ej. Abril 2025"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Archivo GeoJSON</label>
            <input
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              onChange={(e) => setGeojsonFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-ink file:text-white hover:file:bg-ink/90"
              required
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={busyUpload}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-electric text-white rounded-md hover:brightness-110 disabled:opacity-60"
            >
              {busyUpload ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Crear versión y activar
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4">
          {versions.length} versiones
        </h2>
        {versions.length === 0 ? (
          <div className="border border-hairline rounded-lg p-8 text-center text-muted-text font-mono text-xs bg-surface">
            No hay versiones del mapa. Sube la primera.
          </div>
        ) : (
          <div className="border border-hairline rounded-lg overflow-hidden bg-surface">
            {versions.map((v, i) => (
              <div
                key={v.id}
                className={`flex flex-wrap items-center gap-4 p-4 ${i > 0 ? "border-t border-hairline" : ""}`}
              >
                <div className="font-semibold text-foreground text-lg tabular-nums w-10 leading-none">
                  <FileJson className="size-5" />
                </div>
                <div className="flex-1 min-w-[180px]">
                  <div className="font-syne font-bold text-ink flex items-center gap-2">
                    {v.nombre}
                    {v.activa && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono tracking-widest border rounded uppercase bg-success/15 text-success border-success/30">
                        <Check className="size-3" /> Activa
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase">
                    {v.cp_count} CP · {new Date(v.created_at).toLocaleDateString("es-ES")}
                  </div>
                </div>
                {!v.activa && (
                  <button
                    onClick={() => onActivate(v.id)}
                    className="px-3 py-1.5 text-xs font-syne font-semibold rounded transition-colors bg-surface-2 text-muted-text border border-hairline hover:text-ink"
                  >
                    Activar
                  </button>
                )}
                <button
                  onClick={() => onDelete(v)}
                  className="p-1.5 text-muted-text hover:text-danger"
                  aria-label="Eliminar"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DataTab({
  activeVersion,
  csvText,
  setCsvText,
  csvRows,
  csvError,
  onImport,
  busyImport,
}: {
  activeVersion: Version | undefined;
  csvText: string;
  setCsvText: (s: string) => void;
  csvRows: Record<string, string | number>[];
  csvError: string | null;
  onImport: () => Promise<void>;
  busyImport: boolean;
}) {
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(String(ev.target?.result ?? ""));
    reader.readAsText(file);
  };

  if (!activeVersion) {
    return (
      <div className="border border-hairline rounded-lg p-8 text-center bg-surface">
        <AlertCircle className="size-6 text-muted-text mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No hay una versión activa del mapa.</p>
        <p className="text-xs text-muted-text mt-1">Crea una versión en la pestaña anterior para poder importar datos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <FileSpreadsheet className="size-4" /> Importar datos por CP
        </h2>
        <span className="text-xs text-muted-foreground">
          Versión activa: <b>{activeVersion.nombre}</b>
        </span>
      </div>

      <div className="border border-hairline rounded-lg p-6 bg-surface space-y-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">CSV o pegar texto</label>
          <textarea
            className={`${inputCls} min-h-[160px] font-mono text-xs`}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="cp,dsp,hub,sla_teorico,sla_fijo,volumen\n03001,DKNS Transportes S.L.,Alicante Centro,T+1,T+1,120"
          />
        </div>
        <div className="flex items-center gap-4">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="block text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-ink file:text-white hover:file:bg-ink/90"
          />
        </div>

        {csvError && <ErrorBanner msg={`Error parseando CSV: ${csvError}`} />}

        {csvRows.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {csvRows.length} filas detectadas. Vista previa de las primeras 5:
            <div className="mt-2 overflow-x-auto border border-hairline rounded-md">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-2 text-muted-text">
                  <tr>
                    {Object.keys(csvRows[0]).map((k) => (
                      <th key={k} className="px-3 py-2 font-mono">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csvRows.slice(0, 5).map((r, idx) => (
                    <tr key={idx} className="border-t border-hairline">
                      {Object.values(r).map((v, i) => (
                        <td key={i} className="px-3 py-2">
                          {String(v ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            onClick={onImport}
            disabled={busyImport || csvRows.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-electric text-white rounded-md hover:brightness-110 disabled:opacity-60"
          >
            {busyImport ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Importar {csvRows.length > 0 ? `${csvRows.length} CP` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-danger/10 text-danger px-3 py-2 text-sm">
      <AlertCircle className="size-4 shrink-0 mt-0.5" />
      <span>{msg}</span>
    </div>
  );
}
