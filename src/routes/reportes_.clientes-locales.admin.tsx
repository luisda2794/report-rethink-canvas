import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Plus, Trash2, X } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getClientesLocalesConfig,
  saveClientesLocalesConfig,
  type ClientesLocalesConfig,
  type CpLocalidad,
} from "@/lib/clientes-locales-config";

export const Route = createFileRoute("/reportes_/clientes-locales/admin")({
  component: () => (
    <RequireAuth path="/reportes">
      <ClientesLocalesAdminPage />
    </RequireAuth>
  ),
  head: () => ({
    meta: [
      { title: "Menssajero — Configuración Clientes Locales" },
      {
        name: "description",
        content: "Reglas de exclusión/inclusión y mapeo CP → Localidad para el módulo de Clientes Locales.",
      },
    ],
  }),
});

function StringListEditor({
  title,
  description,
  items,
  onChange,
}: {
  title: string;
  description: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft("");
  };
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Agregar valor…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button onClick={add} size="sm" className="gap-2 shrink-0">
            <Plus className="size-4" /> Agregar
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin valores.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {items.map((item, i) => (
              <div key={`${item}-${i}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
                <span className="truncate">{item}</span>
                <button
                  onClick={() => remove(i)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label={`Quitar ${item}`}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CpMappingEditor({ rows, onChange }: { rows: CpLocalidad[]; onChange: (rows: CpLocalidad[]) => void }) {
  const updateRow = (i: number, patch: Partial<CpLocalidad>) => {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const addRow = () => onChange([...rows, { cp: "", localidad: "", fase: "" }]);

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Mapeo CP → Localidad</CardTitle>
        <CardDescription>Código postal, localidad y fase. Se usa para mostrar la localidad en los reportes.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">CP</TableHead>
                <TableHead>Localidad</TableHead>
                <TableHead className="w-32">Fase</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input value={r.cp} onChange={(e) => updateRow(i, { cp: e.target.value })} className="h-8" />
                  </TableCell>
                  <TableCell>
                    <Input value={r.localidad} onChange={(e) => updateRow(i, { localidad: e.target.value })} className="h-8" />
                  </TableCell>
                  <TableCell>
                    <Input value={r.fase} onChange={(e) => updateRow(i, { fase: e.target.value })} className="h-8" />
                  </TableCell>
                  <TableCell>
                    <button
                      onClick={() => removeRow(i)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Quitar fila"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Button onClick={addRow} size="sm" variant="outline" className="mt-3 gap-2">
          <Plus className="size-4" /> Agregar fila
        </Button>
      </CardContent>
    </Card>
  );
}

function ClientesLocalesAdminPage() {
  const [config, setConfig] = useState<ClientesLocalesConfig>(() => getClientesLocalesConfig());

  const update = (patch: Partial<ClientesLocalesConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveClientesLocalesConfig(next);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          to="/reportes/clientes-locales"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Volver a Clientes Locales
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración — Clientes Locales</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reglas y mapeo usados para clasificar clientes locales. Se guarda en este navegador (localStorage), no en el servidor.
        </p>
      </header>

      <Tabs defaultValue="reglas">
        <TabsList>
          <TabsTrigger value="reglas">Reglas Cliente Local</TabsTrigger>
          <TabsTrigger value="mapeo">Mapeo CP → Localidad</TabsTrigger>
        </TabsList>
        <TabsContent value="reglas" className="flex flex-col gap-4 mt-4">
          <StringListEditor
            title="Excluir Marketplace"
            description='Si "Nombre del mercado" tiene valor y está en esta lista, el paquete NO es cliente local.'
            items={config.excludeMarketplace}
            onChange={(items) => update({ excludeMarketplace: items })}
          />
          <StringListEditor
            title="Incluir Seller"
            description='Si "Nombre del vendedor" coincide exactamente con un valor de esta lista, el paquete SÍ es cliente local.'
            items={config.includeSeller}
            onChange={(items) => update({ includeSeller: items })}
          />
        </TabsContent>
        <TabsContent value="mapeo" className="mt-4">
          <CpMappingEditor rows={config.cpMapping} onChange={(rows) => update({ cpMapping: rows })} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
