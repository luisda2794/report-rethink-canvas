import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, AlertCircle, Loader2 } from "lucide-react";
import {
  getReclamacionByToken,
  respondReclamacionByToken,
} from "@/lib/reclamaciones-public.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/rec/$token")({
  component: PublicRecPage,
  head: () => ({
    meta: [
      { title: "Responder reclamación" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

const TIPOS = [
  "Entrega incorrecta",
  "Paquete dañado",
  "Paquete perdido",
  "Entrega en lugar incorrecto",
  "No entregado al destinatario",
  "Otro",
] as const;

type Rec = {
  id: string;
  ref: string;
  waybill: string | null;
  lp_no: string | null;
  driver_nombre: string | null;
  fecha_entrega: string | null;
  tipo: string;
  importe: number | null;
  cp: string | null;
  comentarios: string | null;
  estado: string;
  respuesta_driver: string | null;
  nombre_driver_resp: string | null;
  evidencia_driver: string | null;
  fecha_respuesta: string | null;
};

function PublicRecPage() {
  const { token } = useParams({ from: "/rec/$token" });
  const fetchByToken = useServerFn(getReclamacionByToken);
  const respond = useServerFn(respondReclamacionByToken);

  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "notfound" }
    | { kind: "form"; rec: Rec }
    | { kind: "already"; rec: Rec }
    | { kind: "success" }
  >({ kind: "loading" });

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchByToken({ data: { token } });
        if (res.notFound) return setState({ kind: "notfound" });
        const rec = res.reclamacion as Rec;
        if (rec.estado === "respondida_driver" || rec.estado === "cerrada") {
          setState({ kind: "already", rec });
        } else {
          setState({ kind: "form", rec });
        }
      } catch {
        setState({ kind: "notfound" });
      }
    })();
  }, [token, fetchByToken]);

  if (state.kind === "loading") {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" /> Cargando reclamación…
        </div>
      </Shell>
    );
  }

  if (state.kind === "notfound") {
    return (
      <Shell>
        <div className="text-center py-12">
          <AlertCircle className="size-10 text-destructive mx-auto mb-4" />
          <h1 className="text-2xl font-semibold mb-2">Enlace no válido</h1>
          <p className="text-muted-foreground">Esta reclamación no existe o el enlace ha caducado.</p>
        </div>
      </Shell>
    );
  }

  if (state.kind === "success") {
    return (
      <Shell>
        <div className="text-center py-12">
          <div className="size-14 bg-success/15 border border-success/30 rounded-full grid place-items-center mx-auto mb-4">
            <Check className="size-7 text-success" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">Respuesta enviada</h1>
          <p className="text-muted-foreground">Gracias, hemos recibido tu respuesta.</p>
        </div>
      </Shell>
    );
  }

  if (state.kind === "already") {
    const { rec } = state;
    return (
      <Shell>
        <RecHeader rec={rec} />
        <div className="mt-6 p-5 bg-success/10 border border-success/30 rounded-lg">
          <div className="text-[11px] uppercase tracking-wide text-success mb-2">
            Ya respondida{rec.nombre_driver_resp ? ` por ${rec.nombre_driver_resp}` : ""}
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap">{rec.respuesta_driver}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <RecHeader rec={state.rec} />
      <RespondForm
        token={token}
        defaultName={state.rec.driver_nombre ?? ""}
        onRespond={async (payload) => {
          await respond({ data: { token, ...payload } });
          setState({ kind: "success" });
        }}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-xl mx-auto px-6 py-10">
        <div className="mb-8">
          <div className="text-[11px] tracking-wide text-muted-foreground uppercase">
            Menssajero · Reclamación
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function RecHeader({ rec }: { rec: Rec }) {
  return (
    <div className="bg-card border rounded-lg p-5">
      <div className="text-xs text-electric mb-2">{rec.ref}</div>
      <h1 className="text-xl font-semibold mb-4">{rec.tipo}</h1>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Item k="Waybill" v={rec.waybill} />
        <Item k="LP No." v={rec.lp_no} />
        <Item k="Fecha" v={rec.fecha_entrega} />
        <Item k="CP" v={rec.cp} />
        <Item k="Importe" v={rec.importe ? `${Number(rec.importe).toFixed(2)} €` : null} />
      </dl>
      {rec.comentarios && (
        <div className="mt-4 pt-4 border-t">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
            Comentarios del responsable
          </div>
          <p className="text-sm text-foreground/80 whitespace-pre-wrap">{rec.comentarios}</p>
        </div>
      )}
    </div>
  );
}

function Item({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</dt>
      <dd className="text-foreground">{v ?? "—"}</dd>
    </div>
  );
}

function RespondForm({
  defaultName,
  onRespond,
}: {
  token: string;
  defaultName: string;
  onRespond: (payload: {
    tipo: (typeof TIPOS)[number];
    descripcion: string;
    nombre: string;
    evidencia_url?: string | null;
  }) => Promise<void>;
}) {
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>(TIPOS[0]);
  const [descripcion, setDescripcion] = useState("");
  const [nombre, setNombre] = useState(defaultName);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (descripcion.trim().length < 20) {
      setError("La descripción debe tener al menos 20 caracteres.");
      return;
    }
    if (!nombre.trim()) {
      setError("Introduce tu nombre.");
      return;
    }
    setSubmitting(true);
    try {
      let evidencia_url: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("rec-evidencias").upload(path, file);
        if (upErr) throw new Error(upErr.message);
        const { data } = supabase.storage.from("rec-evidencias").getPublicUrl(path);
        evidencia_url = data.publicUrl;
      }
      await onRespond({ tipo, descripcion: descripcion.trim(), nombre: nombre.trim(), evidencia_url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 bg-card border rounded-lg p-5 space-y-4">
      <h2 className="text-lg font-semibold">Tu respuesta</h2>

      <label className="block">
        <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
          ¿Qué ocurrió?
        </span>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as (typeof TIPOS)[number])}
          className="w-full appearance-none pl-3 pr-8 py-2 text-sm bg-background border rounded-md text-foreground"
        >
          {TIPOS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
          Descripción detallada (mín. 20 caracteres)
        </span>
        <Textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={5}
          required
          minLength={20}
        />
        <span className="block text-[11px] text-muted-foreground mt-1">
          {descripcion.length}/20
        </span>
      </label>

      <label className="block">
        <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
          Tu nombre
        </span>
        <Input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
        />
      </label>

      <label className="block">
        <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
          Foto (opcional)
        </span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:py-2 file:px-3 file:border-0 file:bg-ink file:text-white file:text-xs file:rounded file:cursor-pointer"
        />
      </label>

      {error && (
        <div className="px-3 py-2 bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded">
          {error}
        </div>
      )}

      <Button type="submit" disabled={submitting} className="w-full bg-ink hover:bg-ink/90">
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {submitting ? "Enviando…" : "Enviar respuesta"}
      </Button>
    </form>
  );
}
