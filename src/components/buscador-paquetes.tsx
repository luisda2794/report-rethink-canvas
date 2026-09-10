import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  MapPin,
  PackageSearch,
  Search,
  Truck,
  User,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { usePaqueteBuscador, type EventoTrayectoria } from "@/lib/paquete-buscador";

function hubLabel(hubId: string, hubs: { id: string; nombre: string; marca: string }[]): string {
  const hub = hubs.find((h) => h.id === hubId);
  return hub ? `${hub.marca} · ${hub.nombre}` : "Hub no identificado";
}

function estadoBadge(e: EventoTrayectoria) {
  if (e.esEntrega) return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">{e.estado}</Badge>;
  if (e.esFallo) return <Badge variant="destructive">{e.estado}</Badge>;
  return <Badge variant="secondary">{e.estado}</Badge>;
}

function formatGap(m: number | null): string {
  if (m == null) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function BuscadorPaquetes() {
  const { hubs } = useAuth();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const { data, isFetching, isError, isSuccess } = usePaqueteBuscador(query);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(input.trim());
  };

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Waybill o LP…"
            className="pl-8"
          />
        </div>
        <Button type="submit" disabled={!input.trim()} className="gap-2">
          <Search className="size-3.5" /> Buscar
        </Button>
      </form>

      {!query && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <PackageSearch className="size-4" /> Escribe un Waybill o LP y pulsa Buscar. Encuentra el paquete en
          cualquier hub al que tengas acceso, no solo el hub seleccionado arriba.
        </p>
      )}

      {query && isFetching && <p className="text-sm text-muted-foreground">Buscando…</p>}
      {query && isError && <p className="text-sm text-destructive">No se pudo buscar el paquete.</p>}
      {query && isSuccess && !data && (
        <div className="p-6 bg-card border rounded-lg text-sm text-muted-foreground">
          Sin resultados para <span className="font-semibold text-foreground">{query}</span>. Revisa que el
          Waybill/LP esté bien escrito, o que el paquete pertenezca a un hub al que tienes acceso.
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-4">
          {/* Resumen */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryCard
              icon={data.entregado ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Truck className="size-4" />}
              label="Estado actual"
              value={data.estadoActual ?? "—"}
            />
            <SummaryCard
              icon={<MapPin className="size-4" />}
              label="CD actual"
              value={data.hubActualId ? hubLabel(data.hubActualId, hubs) : "—"}
            />
            <SummaryCard
              icon={<AlertTriangle className="size-4" />}
              label="Intentos de entrega fallidos"
              value={String(data.intentosFallidos)}
            />
            <SummaryCard
              icon={<AlertTriangle className="size-4" />}
              label="Incidencias registradas"
              value={String(data.incidencias.length)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <InfoRow label="Waybill" value={data.waybill ?? "—"} />
            <InfoRow label="LP" value={data.lpNo} />
            <InfoRow label="Fecha inbound" value={data.fechaInbound ?? "—"} />
            {data.marketPlaceName && <InfoRow label="Marketplace" value={data.marketPlaceName} />}
            {data.sellerName && <InfoRow label="Seller" value={data.sellerName} />}
          </div>

          {data.reclamaciones.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="size-4" /> {data.reclamaciones.length} reclamación(es) asociada(s)
              </p>
              <div className="flex flex-col gap-1.5">
                {data.reclamaciones.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
                    <span className="font-semibold">{r.ref}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {r.tipo}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {r.estado}
                    </Badge>
                    {r.importe != null && <span>{r.importe.toFixed(2)} €</span>}
                    {r.comentarios && <span className="truncate italic">"{r.comentarios}"</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trayectoria */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Trayectoria del paquete</h3>
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 text-left">Fecha</th>
                    <th className="px-3 py-2.5 text-left">Estado</th>
                    <th className="px-3 py-2.5 text-left">CD</th>
                    <th className="px-3 py-2.5 text-left">Driver</th>
                    <th className="px-3 py-2.5 text-left">Dirección / CP</th>
                    <th className="px-3 py-2.5 text-left">Incidencia</th>
                    <th className="px-3 py-2.5 text-right">Gap distancia</th>
                  </tr>
                </thead>
                <tbody>
                  {data.eventos.map((e) => (
                    <tr key={e.id} className={`border-t border-border ${e.esIncidencia ? "bg-destructive/5" : ""}`}>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">{e.fechaEvento ?? e.fecha ?? "—"}</td>
                      <td className="px-3 py-2">{estadoBadge(e)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">{hubLabel(e.hubId, hubs)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-foreground">
                        {e.driver ? (
                          <span className="inline-flex items-center gap-1">
                            <User className="size-3 text-muted-foreground" /> {e.driver}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="max-w-[260px] truncate px-3 py-2 text-foreground" title={e.direccion ?? undefined}>
                        {e.direccion || "—"} {e.cp ? `(${e.cp})` : ""}
                      </td>
                      <td className="max-w-[260px] truncate px-3 py-2 text-foreground" title={e.incidenciaDetalle ?? undefined}>
                        {e.incidenciaDetalle ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatGap(e.gapMetros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      <span className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground">
        {icon} {label}
      </span>
      <span className="truncate text-sm font-semibold text-foreground" title={value}>
        {value}
      </span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
      <span className="text-[11px] uppercase text-muted-foreground">{label}</span>
      <span className="truncate font-medium text-foreground">{value}</span>
    </div>
  );
}
