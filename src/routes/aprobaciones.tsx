import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, X, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { Topbar } from "@/components/Topbar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  aprobarSolicitud,
  rechazarSolicitud,
  etapaDeRol,
  estadoPendienteDeEtapa,
  ESTADO_LABEL,
  ESTADO_COLOR,
  TIPO_SOLICITUD_LABEL,
  type SolicitudTarifa,
  type ValoresTarifa,
} from "@/lib/solicitudes-tarifa";

export const Route = createFileRoute("/aprobaciones")({
  component: () => (
    <RequireAuth path="/aprobaciones">
      <AprobacionesPage />
    </RequireAuth>
  ),
  head: () => ({ meta: [{ title: "Menssajero — Aprobaciones" }] }),
});

const CAMPO_LABEL: Record<keyof ValoresTarifa, string> = {
  tarifa_to_door: "TO_DOOR (€)",
  tarifa_pudo_primero: "PUDO · 1º del día (€)",
  tarifa_pudo_extra: "PUDO · extra (€)",
  precio_salida: "Precio de salida (€)",
  nota: "Nota",
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toFixed(4).replace(/\.?0+$/, "") || "0";
  return String(v);
}

function ComparacionValores({ antes, despues }: { antes: ValoresTarifa | null; despues: ValoresTarifa }) {
  const campos = Object.keys(despues) as (keyof ValoresTarifa)[];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs font-mono">
      {campos.map((c) => {
        const before = antes?.[c] ?? null;
        const after = despues[c] ?? null;
        const changed = String(before ?? "") !== String(after ?? "");
        if (after === null || after === undefined) return null;
        return (
          <div key={c} className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-muted-text">{CAMPO_LABEL[c]}</span>
            <span className="flex items-center gap-1.5">
              {antes && <span className="text-muted-text line-through">{fmt(before)}</span>}
              <span className={changed ? "text-electric font-semibold" : "text-ink"}>{fmt(after)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SolicitudCard({
  s,
  accionable,
  onApprove,
  onReject,
  busy,
}: {
  s: SolicitudTarifa;
  accionable: boolean;
  onApprove: (s: SolicitudTarifa) => void;
  onReject: (s: SolicitudTarifa, motivo: string) => void;
  busy: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [motivo, setMotivo] = useState("");

  return (
    <div className="bg-surface border border-hairline rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-ink">
            {s.driver_nombre} <span className="text-muted-text font-normal">· CP {s.codigo_postal}</span>
          </p>
          <p className="text-xs text-muted-text mt-0.5">
            {s.hub_nombre} · {TIPO_SOLICITUD_LABEL[s.tipo]}
            {s.fecha ? ` · ${s.fecha}` : ""}
          </p>
          <p className="text-[11px] text-muted-text mt-1 font-mono">
            Solicitado por {s.solicitado_por_nombre} · {new Date(s.solicitado_en).toLocaleString("es-ES")}
          </p>
        </div>
        <span className={`shrink-0 px-2 py-1 rounded border text-[10px] font-mono uppercase tracking-wide ${ESTADO_COLOR[s.estado]}`}>
          {ESTADO_LABEL[s.estado]}
        </span>
      </div>

      <ComparacionValores antes={s.valores_anteriores} despues={s.valores_propuestos} />

      {s.estado === "rechazado" && (
        <div className="px-3 py-2 rounded border-l-2 border-danger bg-danger/10 text-xs">
          <p className="text-danger font-medium">
            Rechazado por {s.rechazado_nombre} en etapa {s.rechazado_en_etapa} · {s.rechazado_en ? new Date(s.rechazado_en).toLocaleString("es-ES") : ""}
          </p>
          {s.motivo_rechazo && <p className="text-ink mt-1">{s.motivo_rechazo}</p>}
        </div>
      )}

      {accionable && (
        <div className="pt-2 border-t border-hairline/60">
          {rejecting ? (
            <div className="space-y-2">
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivo del rechazo (obligatorio)"
                className="w-full border border-hairline rounded px-3 py-2 text-xs bg-background font-mono min-h-[70px]"
                autoFocus
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => { setRejecting(false); setMotivo(""); }}
                  className="px-3 py-1.5 text-xs font-mono text-muted-text hover:text-ink"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => onReject(s, motivo.trim())}
                  disabled={busy || !motivo.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-danger text-white rounded text-xs font-mono uppercase tracking-wide hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                  Confirmar rechazo
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setRejecting(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-danger/40 text-danger rounded text-xs font-mono uppercase tracking-wide hover:bg-danger/10 disabled:opacity-50"
              >
                <X className="size-3.5" /> Rechazar
              </button>
              <button
                onClick={() => onApprove(s)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink text-white rounded text-xs font-mono uppercase tracking-wide hover:bg-electric disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Aprobar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AprobacionesPage() {
  const { role, user, profile } = useAuth();
  const etapa = etapaDeRol(role);
  const [items, setItems] = useState<SolicitudTarifa[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("solicitudes_tarifa")
      .select("*")
      .order("solicitado_en", { ascending: false });
    if (error) toast.error(error.message);
    setItems((data ?? []) as SolicitudTarifa[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actorNombre = profile?.full_name?.trim() || user?.email || "—";

  const miEtapaEstado = etapa ? estadoPendienteDeEtapa(etapa) : null;
  const pendientes = miEtapaEstado ? items.filter((s) => s.estado === miEtapaEstado) : [];
  const resto = miEtapaEstado ? items.filter((s) => s.estado !== miEtapaEstado) : items;

  const handleApprove = async (s: SolicitudTarifa) => {
    if (!etapa || !user) return;
    setBusyId(s.id);
    const { error } = await aprobarSolicitud(s, etapa, user.id, actorNombre);
    if (error) {
      toast.error(error);
    } else {
      toast.success(etapa === "admin" ? "Aprobado — cambio aplicado" : "Aprobado, avanzó a la siguiente etapa");
      await load();
    }
    setBusyId(null);
  };

  const handleReject = async (s: SolicitudTarifa, motivo: string) => {
    if (!etapa || !user || !motivo) return;
    setBusyId(s.id);
    const { error } = await rechazarSolicitud(s, etapa, user.id, actorNombre, motivo);
    if (error) {
      toast.error(error);
    } else {
      toast.success("Solicitud rechazada");
      await load();
    }
    setBusyId(null);
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-syne flex flex-col">
      <Topbar section="Aprobaciones" />
      <div className="flex-1 px-6 lg:px-12 py-10 lg:py-14">
        <div className="max-w-3xl mx-auto space-y-10">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Aprobaciones de tarifa</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Cadena: Jefe de Flota solicita → Manager → Jefe Contable → Admin aplica.
            </p>
          </header>

          {!etapa ? (
            <div className="px-4 py-6 border-l-2 border-amber-500 bg-amber-500/10 text-amber-700 font-mono text-xs rounded-r">
              Tu rol no participa en la cadena de aprobación.
            </div>
          ) : loading ? (
            <p className="text-muted-text font-mono text-xs">Cargando…</p>
          ) : (
            <>
              <section className="space-y-3">
                <h2 className="text-xs font-mono uppercase tracking-widest text-muted-text flex items-center gap-2">
                  <Clock className="size-3.5" /> Esperando tu aprobación ({pendientes.length})
                </h2>
                {pendientes.length === 0 ? (
                  <p className="text-sm text-muted-text">No hay solicitudes esperando en tu etapa.</p>
                ) : (
                  <div className="space-y-3">
                    {pendientes.map((s) => (
                      <SolicitudCard
                        key={s.id}
                        s={s}
                        accionable
                        onApprove={handleApprove}
                        onReject={handleReject}
                        busy={busyId === s.id}
                      />
                    ))}
                  </div>
                )}
              </section>

              {resto.length > 0 && (
                <section className="space-y-3">
                  <h2 className="text-xs font-mono uppercase tracking-widest text-muted-text">
                    Otras solicitudes (en otra etapa o resueltas)
                  </h2>
                  <div className="space-y-3 opacity-80">
                    {resto.map((s) => (
                      <SolicitudCard
                        key={s.id}
                        s={s}
                        accionable={false}
                        onApprove={handleApprove}
                        onReject={handleReject}
                        busy={false}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
