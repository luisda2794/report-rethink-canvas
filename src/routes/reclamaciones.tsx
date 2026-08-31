import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  X,
  Send,
  Check,
  Pencil,
  Trash2,
  ExternalLink,
  Copy,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/reclamaciones")({
  component: () => (
    <RequireAuth path="/reclamaciones">
      <ReclamacionesPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Reclamaciones" }] }),
});

type Estado =
  | "abierta"
  | "enviada_driver"
  | "respondida_driver"
  | "cerrada";

type Reclamacion = {
  id: string;
  ref: string;
  hub_id: string;
  waybill: string | null;
  lp_no: string | null;
  driver_id: string | null;
  driver_nombre: string | null;
  driver_telefono: string | null;
  fecha_entrega: string | null;
  tipo: string;
  importe: number | null;
  cp: string | null;
  comentarios: string | null;
  evidencia: string | null;
  estado: Estado;
  token: string;
  respuesta_driver: string | null;
  evidencia_driver: string | null;
  nombre_driver_resp: string | null;
  fecha_envio_whatsapp: string | null;
  fecha_respuesta: string | null;
  nota_cierre: string | null;
  fecha_cierre: string | null;
  created_at: string;
};

type DriverOption = {
  id: string;
  nombre: string;
  telefono: string | null;
};

const TIPOS = [
  "Entrega incorrecta",
  "Paquete dañado",
  "Paquete perdido",
  "Entrega en lugar incorrecto",
  "No entregado al destinatario",
  "Otro",
] as const;

const ESTADO_LABEL: Record<Estado, string> = {
  abierta: "Abierta",
  enviada_driver: "Enviada al driver",
  respondida_driver: "Respondida",
  cerrada: "Cerrada",
};

function estadoClass(e: Estado): string {
  switch (e) {
    case "abierta":
      return "border-danger/40 text-danger";
    case "enviada_driver":
      return "border-electric/40 text-electric";
    case "respondida_driver":
      return "border-amber-400/60 text-amber-700 dark:text-amber-400";
    case "cerrada":
      return "border-success/40 text-success";
  }
}

// --- SLA: 40h desde "Enviada al Driver" hasta "Respondida por Driver" ---
const SLA_HOURS = 40;
const SLA_WARN_MARGIN_HOURS = 8;

type SlaTone = "green" | "yellow" | "red";

type SlaInfo = {
  tone: SlaTone;
  hoursElapsed: number;
  hoursLeft: number;
  live: boolean; // true si todavía corre el reloj (esperando respuesta)
};

function computeSla(r: Reclamacion, nowMs: number): SlaInfo | null {
  if (!r.fecha_envio_whatsapp) return null;
  const start = new Date(r.fecha_envio_whatsapp).getTime();
  const waiting = !r.fecha_respuesta;
  const end = waiting ? nowMs : new Date(r.fecha_respuesta as string).getTime();
  const hoursElapsed = (end - start) / 3_600_000;
  const hoursLeft = SLA_HOURS - hoursElapsed;
  const tone: SlaTone = hoursLeft < 0 ? "red" : hoursLeft <= SLA_WARN_MARGIN_HOURS ? "yellow" : "green";
  return { tone, hoursElapsed, hoursLeft, live: waiting };
}

function formatHours(h: number): string {
  const abs = Math.abs(h);
  if (abs < 1) return `${Math.round(abs * 60)} min`;
  return `${abs.toFixed(1)} h`;
}

function SlaBadge({ rec, nowMs }: { rec: Reclamacion; nowMs: number }) {
  const sla = computeSla(rec, nowMs);
  if (!sla) return <span className="text-muted-text text-xs">—</span>;
  const toneClass: Record<SlaTone, string> = {
    green: "border-success/40 text-success",
    yellow: "border-amber-400/60 text-amber-700 dark:text-amber-400",
    red: "border-danger/40 text-danger",
  };
  const label = sla.live
    ? sla.hoursLeft >= 0
      ? `Quedan ${formatHours(sla.hoursLeft)}`
      : `Vencida hace ${formatHours(sla.hoursLeft)}`
    : sla.hoursLeft >= 0
      ? `Respondida en ${formatHours(sla.hoursElapsed)}`
      : `Respondida fuera de plazo (${formatHours(sla.hoursElapsed)})`;
  return (
    <Badge
      variant="outline"
      className={`gap-1 font-mono text-[10px] tracking-wide font-normal ${toneClass[sla.tone]}`}
      title={`SLA 40h desde envío al driver. Transcurridas: ${formatHours(sla.hoursElapsed)}`}
    >
      <Clock className="size-3" /> {label}
    </Badge>
  );
}

function buildWhatsAppUrl(telefono: string, message: string): string {
  const digits = telefono.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function ReclamacionesPage() {
  const { selectedHub, user } = useAuth();
  const [rows, setRows] = useState<Reclamacion[]>([]);
  const [driversList, setDriversList] = useState<DriverOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [estadoFilter, setEstadoFilter] = useState<"todas" | Estado>("todas");
  const [driverFilter, setDriverFilter] = useState<string>("todos");
  const [openModal, setOpenModal] = useState<{ mode: "create" } | { mode: "edit"; row: Reclamacion } | null>(null);
  const [selected, setSelected] = useState<Reclamacion | null>(null);
  const [closing, setClosing] = useState<Reclamacion | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // El SLA es dinámico: se re-renderiza solo cada minuto para mover el
  // semáforo verde/amarillo/rojo sin depender de ninguna acción manual.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const load = async () => {
    if (!selectedHub) return;
    setLoading(true);
    const [recRes, drvRes] = await Promise.all([
      supabase
        .from("reclamaciones")
        .select("*")
        .eq("hub_id", selectedHub.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("drivers")
        .select("id, nombre, telefono")
        .eq("hub_id", selectedHub.id)
        .order("nombre"),
    ]);
    if (recRes.error) {
      toast.error(recRes.error.message);
    } else {
      setRows((recRes.data as Reclamacion[]) ?? []);
    }
    if (drvRes.error) toast.error(drvRes.error.message);
    else setDriversList((drvRes.data as DriverOption[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHub?.id]);

  // Realtime
  useEffect(() => {
    if (!selectedHub) return;
    const channel = supabase
      .channel(`reclamaciones:${selectedHub.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reclamaciones", filter: `hub_id=eq.${selectedHub.id}` },
        (payload) => {
          setRows((prev) => {
            if (payload.eventType === "INSERT") return [payload.new as Reclamacion, ...prev];
            if (payload.eventType === "UPDATE") {
              const updated = payload.new as Reclamacion;
              setSelected((s) => (s && s.id === updated.id ? updated : s));
              return prev.map((r) => (r.id === updated.id ? updated : r));
            }
            if (payload.eventType === "DELETE") {
              const oldRow = payload.old as { id: string };
              return prev.filter((r) => r.id !== oldRow.id);
            }
            return prev;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedHub?.id]);

  const drivers = useMemo(
    () => Array.from(new Set(rows.map((r) => r.driver_nombre).filter((d): d is string => !!d))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (estadoFilter !== "todas" && r.estado !== estadoFilter) return false;
      if (driverFilter !== "todos" && r.driver_nombre !== driverFilter) return false;
      if (q) {
        const hay = `${r.waybill ?? ""} ${r.lp_no ?? ""} ${r.driver_nombre ?? ""} ${r.ref}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, estadoFilter, driverFilter]);

  const counts = useMemo(() => {
    const c: Record<Estado, number> = {
      abierta: 0,
      enviada_driver: 0,
      respondida_driver: 0,
      cerrada: 0,
    };
    rows.forEach((r) => {
      c[r.estado] = (c[r.estado] ?? 0) + 1;
    });
    return c;
  }, [rows]);

  const updateEstado = async (id: string, estado: Estado, extra: Record<string, unknown> = {}) => {
    const { error } = await supabase.from("reclamaciones").update({ estado, ...extra }).eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Estado actualizado");
  };

  const enviarADriver = async (r: Reclamacion) => {
    const publicUrl = `${window.location.origin}/rec/${r.token}`;
    if (!r.driver_telefono) {
      toast.error("Este driver no tiene teléfono registrado", {
        description: "Añádelo en la reclamación o en Drivers antes de enviar por WhatsApp.",
      });
      return;
    }
    await updateEstado(r.id, "enviada_driver", { fecha_envio_whatsapp: new Date().toISOString() });
    const mensaje = `Hola${r.driver_nombre ? ` ${r.driver_nombre}` : ""}, tienes una reclamación (${r.ref}) pendiente de respuesta. Por favor complétala en las próximas 40h en este link: ${publicUrl}`;
    window.open(buildWhatsAppUrl(r.driver_telefono, mensaje), "_blank", "noopener,noreferrer");
  };

  const cerrar = async (r: Reclamacion, nota: string) => {
    await updateEstado(r.id, "cerrada", {
      fecha_cierre: new Date().toISOString(),
      nota_cierre: nota.trim() || null,
    });
    setClosing(null);
  };

  const eliminar = async (r: Reclamacion) => {
    if (!confirm(`¿Eliminar reclamación ${r.ref}?`)) return;
    const { error } = await supabase.from("reclamaciones").delete().eq("id", r.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Reclamación eliminada");
      setSelected(null);
    }
  };

  const copyLink = (r: Reclamacion) => {
    const url = `${window.location.origin}/rec/${r.token}`;
    void navigator.clipboard.writeText(url);
    toast.success("Link copiado");
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Reclamaciones" />

      <div className="flex-1 px-6 lg:px-12 py-8 lg:py-10 min-w-0 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          {/* HEADER */}
          <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Reclamaciones
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {selectedHub ? `${selectedHub.marca} · ${selectedHub.nombre}` : "Sin hub"}
              </p>
            </div>
            <Button
              onClick={() => setOpenModal({ mode: "create" })}
              disabled={!selectedHub}
              className="bg-ink font-syne font-semibold hover:bg-ink/90"
            >
              <Plus className="size-4" /> Nueva reclamación
            </Button>
          </header>

          {/* STATS */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatChip label="Abierta" value={counts.abierta} tone="danger" />
            <StatChip label="Enviada al driver" value={counts.enviada_driver} tone="electric" />
            <StatChip label="Respondida" value={counts.respondida_driver} tone="amber" />
            <StatChip label="Cerrada" value={counts.cerrada} tone="success" />
          </div>

          {/* TOOLBAR */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="size-4 text-muted-text absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por waybill, driver, LP No."
                className="w-full pl-9 pr-3 py-2.5 bg-surface border border-hairline rounded-md text-sm focus:outline-none focus:border-electric"
              />
            </div>
            <select
              value={estadoFilter}
              onChange={(e) => setEstadoFilter(e.target.value as typeof estadoFilter)}
              className="px-3 py-2.5 bg-surface border border-hairline rounded-md text-sm focus:outline-none focus:border-electric"
            >
              <option value="todas">Todos los estados</option>
              {(Object.keys(ESTADO_LABEL) as Estado[]).map((k) => (
                <option key={k} value={k}>
                  {ESTADO_LABEL[k]}
                </option>
              ))}
            </select>
            <select
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
              className="px-3 py-2.5 bg-surface border border-hairline rounded-md text-sm focus:outline-none focus:border-electric"
            >
              <option value="todos">Todos los drivers</option>
              {drivers.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* TABLE */}
          <Card className="overflow-hidden shadow-none">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-surface-2 hover:bg-surface-2">
                    <TableHead className="px-4 font-mono text-[10px] tracking-widest uppercase text-muted-text">ID</TableHead>
                    <TableHead className="px-4 font-mono text-[10px] tracking-widest uppercase text-muted-text">Waybill</TableHead>
                    <TableHead className="px-4 font-mono text-[10px] tracking-widest uppercase text-muted-text">LP No.</TableHead>
                    <TableHead className="px-4 font-mono text-[10px] tracking-widest uppercase text-muted-text">Driver</TableHead>
                    <TableHead className="px-4 font-mono text-[10px] tracking-widest uppercase text-muted-text">Fecha</TableHead>
                    <TableHead className="px-4 font-mono text-[10px] tracking-widest uppercase text-muted-text">Tipo</TableHead>
                    <TableHead className="px-4 text-right font-mono text-[10px] tracking-widest uppercase text-muted-text">Importe</TableHead>
                    <TableHead className="px-4 font-mono text-[10px] tracking-widest uppercase text-muted-text">Estado</TableHead>
                    <TableHead className="px-4 font-mono text-[10px] tracking-widest uppercase text-muted-text">SLA (40h)</TableHead>
                    <TableHead className="px-4 text-right font-mono text-[10px] tracking-widest uppercase text-muted-text">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="px-4 py-10 text-center text-muted-text font-mono text-xs">
                        Cargando…
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="px-4 py-10 text-center text-muted-text font-mono text-xs">
                        Sin reclamaciones
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => (
                      <TableRow
                        key={r.id}
                        onClick={() => setSelected(r)}
                        className="group cursor-pointer"
                      >
                        <TableCell className="px-4 font-mono text-xs text-ink">{r.ref}</TableCell>
                        <TableCell className="px-4 font-mono text-xs">{r.waybill ?? "—"}</TableCell>
                        <TableCell className="px-4 font-mono text-xs">{r.lp_no ?? "—"}</TableCell>
                        <TableCell className="px-4">{r.driver_nombre ?? "—"}</TableCell>
                        <TableCell className="px-4 font-mono text-xs">{r.fecha_entrega ?? "—"}</TableCell>
                        <TableCell className="px-4 truncate max-w-[160px]">{r.tipo}</TableCell>
                        <TableCell className="px-4 text-right font-mono">
                          {r.importe ? `${Number(r.importe).toFixed(2)} €` : "—"}
                        </TableCell>
                        <TableCell className="px-4">
                          <Badge variant="outline" className={`font-mono text-[10px] tracking-widest uppercase font-normal ${estadoClass(r.estado)}`}>
                            {ESTADO_LABEL[r.estado]}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-4">
                          <SlaBadge rec={r} nowMs={nowMs} />
                        </TableCell>
                        <TableCell className="px-4 text-right">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {r.estado === "abierta" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void enviarADriver(r);
                                }}
                                className="font-syne font-semibold text-electric hover:bg-electric/10 hover:text-electric"
                                title="Enviar al driver"
                              >
                                <Send className="size-3.5" /> Enviar
                              </Button>
                            )}
                            {r.estado === "respondida_driver" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setClosing(r);
                                }}
                                className="font-syne font-semibold text-success hover:bg-success/10 hover:text-success"
                                title="Cerrar"
                              >
                                <Check className="size-3.5" /> Cerrar
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenModal({ mode: "edit", row: r });
                              }}
                              className="text-ink hover:bg-ink/5"
                              title="Editar"
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>

      {openModal && selectedHub && user && (
        <FormModal
          mode={openModal.mode}
          row={openModal.mode === "edit" ? openModal.row : null}
          hubId={selectedHub.id}
          userId={user.id}
          drivers={driversList}
          onClose={() => setOpenModal(null)}
          onSaved={() => {
            setOpenModal(null);
          }}
        />
      )}

      {selected && (
        <DetailPanel
          row={selected}
          nowMs={nowMs}
          onClose={() => setSelected(null)}
          onCopy={() => copyLink(selected)}
          onSend={() => void enviarADriver(selected)}
          onCerrar={() => setClosing(selected)}
          onEdit={() => {
            setOpenModal({ mode: "edit", row: selected });
            setSelected(null);
          }}
          onDelete={() => void eliminar(selected)}
        />
      )}

      {closing && (
        <CloseDialog
          row={closing}
          onClose={() => setClosing(null)}
          onConfirm={(nota) => void cerrar(closing, nota)}
        />
      )}
    </div>
  );
}

function CloseDialog({
  row,
  onClose,
  onConfirm,
}: {
  row: Reclamacion;
  onClose: () => void;
  onConfirm: (nota: string) => void;
}) {
  const [nota, setNota] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none">
        <Card className="w-full max-w-md pointer-events-auto shadow-xl">
          <CardHeader className="px-6 py-4 border-b border-hairline">
            <h2 className="font-syne font-bold text-lg">Cerrar {row.ref}</h2>
            <p className="mt-1 text-xs text-muted-text">
              Marca la reclamación como cerrada tras responder a Cainiao en el panel LDS (fuera de este sistema).
            </p>
          </CardHeader>
          <CardContent className="p-6">
            <Field label="Nota de cierre (opcional) · qué se respondió a Cainiao">
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={4}
                autoFocus
                className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-md text-sm focus:outline-none focus:border-electric resize-y"
              />
            </Field>
          </CardContent>
          <CardFooter className="px-6 py-4 border-t border-hairline flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} className="font-syne">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setSaving(true);
                onConfirm(nota);
              }}
              disabled={saving}
              className="bg-success font-syne font-semibold hover:bg-success/90"
            >
              {saving ? "Cerrando…" : "Cerrar reclamación"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "electric" | "amber" | "success";
}) {
  const cls = {
    danger: "bg-danger/10 border-danger/30 text-danger",
    electric: "bg-electric/10 border-electric/30 text-electric",
    amber:
      "bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400",
    success: "bg-success/10 border-success/30 text-success",
  }[tone];
  return (
    <div className={`flex items-center justify-between px-4 py-3 border rounded-lg ${cls}`}>
      <span className="font-mono text-[10px] tracking-widest uppercase">{label}</span>
      <span className="font-syne font-bold text-2xl">{value}</span>
    </div>
  );
}

function DetailPanel({
  row,
  nowMs,
  onClose,
  onCopy,
  onSend,
  onCerrar,
  onEdit,
  onDelete,
}: {
  row: Reclamacion;
  nowMs: number;
  onClose: () => void;
  onCopy: () => void;
  onSend: () => void;
  onCerrar: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const publicUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/rec/${row.token}`;
  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40 animate-fade-in" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-background border-l border-hairline z-50 overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 bg-background border-b border-hairline px-6 py-4 flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] tracking-widest uppercase text-muted-text">Reclamación</div>
            <div className="font-mono text-lg text-ink">{row.ref}</div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <Card className="border-none shadow-none rounded-none">
          <CardContent className="space-y-6">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={`font-mono text-[10px] tracking-widest uppercase font-normal ${estadoClass(row.estado)}`}>
              {ESTADO_LABEL[row.estado]}
            </Badge>
            <SlaBadge rec={row} nowMs={nowMs} />
          </div>

          <DetailGrid
            items={[
              ["Waybill", row.waybill],
              ["LP No.", row.lp_no],
              ["Driver", row.driver_nombre],
              ["Teléfono", row.driver_telefono],
              ["Fecha entrega", row.fecha_entrega],
              ["CP", row.cp],
              ["Tipo", row.tipo],
              ["Importe", row.importe ? `${Number(row.importe).toFixed(2)} €` : null],
            ]}
          />

          {row.comentarios && (
            <Section title="Comentarios">
              <p className="text-sm text-ink/80 whitespace-pre-wrap">{row.comentarios}</p>
            </Section>
          )}

          {row.evidencia && (
            <Section title="Evidencia">
              <a href={row.evidencia} target="_blank" rel="noreferrer" className="text-sm text-electric inline-flex items-center gap-1">
                {row.evidencia} <ExternalLink className="size-3" />
              </a>
            </Section>
          )}

          {row.respuesta_driver && (
            <Section title={`Respuesta del driver${row.nombre_driver_resp ? ` · ${row.nombre_driver_resp}` : ""}`}>
              <p className="text-sm text-ink/80 whitespace-pre-wrap">{row.respuesta_driver}</p>
              {row.evidencia_driver && (
                <a href={row.evidencia_driver} target="_blank" rel="noreferrer" className="mt-2 text-xs text-electric inline-flex items-center gap-1">
                  Ver evidencia <ExternalLink className="size-3" />
                </a>
              )}
            </Section>
          )}

          {row.nota_cierre && (
            <Section title={`Nota de cierre${row.fecha_cierre ? ` · ${new Date(row.fecha_cierre).toLocaleString("es-ES")}` : ""}`}>
              <p className="text-sm text-ink/80 whitespace-pre-wrap">{row.nota_cierre}</p>
            </Section>
          )}

          <Section title="Link público para el driver">
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-surface border border-hairline rounded text-[11px] font-mono break-all">
                {publicUrl}
              </code>
              <Button variant="outline" size="icon" onClick={onCopy} className="bg-surface">
                <Copy className="size-4" />
              </Button>
            </div>
          </Section>

          <div className="space-y-2 pt-2 border-t border-hairline">
            {row.estado === "abierta" && (
              <Button
                onClick={onSend}
                className="w-full bg-electric font-syne font-semibold hover:bg-electric/90"
              >
                <Send className="size-4" /> Enviar reclamación al driver
              </Button>
            )}
            {row.estado === "respondida_driver" && (
              <Button
                onClick={onCerrar}
                className="w-full bg-success font-syne font-semibold hover:bg-success/90"
              >
                <Check className="size-4" /> Cerrar reclamación
              </Button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={onEdit} className="font-syne font-semibold">
                <Pencil className="size-3.5" /> Editar
              </Button>
              <Button variant="outline" onClick={onDelete} className="border-danger/30 bg-danger/10 font-syne font-semibold text-danger hover:bg-danger/20 hover:text-danger">
                <Trash2 className="size-3.5" /> Eliminar
              </Button>
            </div>
          </div>
        </CardContent>
        </Card>
      </aside>
    </>
  );
}

function DetailGrid({ items }: { items: Array<[string, string | number | null | undefined]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="font-mono text-[9px] tracking-widest uppercase text-muted-text mb-0.5">{k}</dt>
          <dd className="text-sm text-ink">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-widest uppercase text-muted-text mb-2">{title}</div>
      {children}
    </div>
  );
}

function FormModal({
  mode,
  row,
  hubId,
  userId,
  drivers,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  row: Reclamacion | null;
  hubId: string;
  userId: string;
  drivers: DriverOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [waybill, setWaybill] = useState(row?.waybill ?? "");
  const [lpNo, setLpNo] = useState(row?.lp_no ?? "");
  const [driverId, setDriverId] = useState(row?.driver_id ?? "");
  const [driver, setDriver] = useState(row?.driver_nombre ?? "");
  const [tel, setTel] = useState(row?.driver_telefono ?? "");
  const [fecha, setFecha] = useState(row?.fecha_entrega ?? "");
  const [tipo, setTipo] = useState<string>(row?.tipo ?? TIPOS[0]);
  const [importe, setImporte] = useState<string>(row?.importe?.toString() ?? "");
  const [cp, setCp] = useState(row?.cp ?? "");
  const [comentarios, setComentarios] = useState(row?.comentarios ?? "");
  const [evidencia, setEvidencia] = useState(row?.evidencia ?? "");
  const [saving, setSaving] = useState(false);

  const selectDriver = (id: string) => {
    setDriverId(id);
    const d = drivers.find((x) => x.id === id);
    setDriver(d?.nombre ?? "");
    setTel(d?.telefono ?? "");
  };

  const save = async () => {
    if (!tipo) {
      toast.error("Selecciona un tipo");
      return;
    }
    setSaving(true);
    const payload = {
      hub_id: hubId,
      waybill: waybill || null,
      lp_no: lpNo || null,
      driver_id: driverId || null,
      driver_nombre: driver || null,
      driver_telefono: tel || null,
      fecha_entrega: fecha || null,
      tipo,
      importe: importe ? Number(importe) : 0,
      cp: cp || null,
      comentarios: comentarios || null,
      evidencia: evidencia || null,
    };
    if (mode === "create") {
      const { error } = await supabase
        .from("reclamaciones")
        .insert({ ...payload, created_by: userId, estado: "abierta" });
      if (error) toast.error(error.message);
      else {
        toast.success("Reclamación creada");
        onSaved();
      }
    } else if (row) {
      const { error } = await supabase.from("reclamaciones").update(payload).eq("id", row.id);
      if (error) toast.error(error.message);
      else {
        toast.success("Reclamación actualizada");
        onSaved();
      }
    }
    setSaving(false);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto pointer-events-auto shadow-xl">
          <CardHeader className="sticky top-0 z-10 bg-background border-b border-hairline px-6 py-4 flex-row items-center justify-between space-y-0">
            <h2 className="font-syne font-bold text-lg">
              {mode === "create" ? "Nueva reclamación" : `Editar ${row?.ref ?? ""}`}
            </h2>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </CardHeader>
          <CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Waybill"><Input value={waybill} onChange={setWaybill} /></Field>
            <Field label="LP No."><Input value={lpNo} onChange={setLpNo} /></Field>
            <Field label="Driver">
              <select
                value={driverId}
                onChange={(e) => selectDriver(e.target.value)}
                className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-md text-sm focus:outline-none focus:border-electric"
              >
                <option value="">— Sin asignar —</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Teléfono driver (WhatsApp)">
              <Input value={tel} onChange={setTel} placeholder="+34..." />
            </Field>
            <Field label="Fecha entrega"><Input type="date" value={fecha} onChange={setFecha} /></Field>
            <Field label="Tipo">
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-md text-sm focus:outline-none focus:border-electric"
              >
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Importe reclamado (€)">
              <Input type="number" value={importe} onChange={setImporte} placeholder="0.00" />
            </Field>
            <Field label="CP">
              <Input value={cp} onChange={setCp} placeholder="28001" maxLength={5} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Comentarios">
                <textarea
                  value={comentarios}
                  onChange={(e) => setComentarios(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-md text-sm focus:outline-none focus:border-electric resize-y"
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Evidencia (URL o referencia)">
                <Input value={evidencia} onChange={setEvidencia} placeholder="https://..." />
              </Field>
            </div>
          </CardContent>
          <CardFooter className="sticky bottom-0 z-10 bg-background border-t border-hairline px-6 py-4 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} className="font-syne">
              Cancelar
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="bg-ink font-syne font-semibold hover:bg-ink/90"
            >
              {saving ? "Guardando…" : mode === "create" ? "Crear reclamación" : "Guardar cambios"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] tracking-widest uppercase text-muted-text mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  placeholder,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-md text-sm focus:outline-none focus:border-electric"
    />
  );
}
