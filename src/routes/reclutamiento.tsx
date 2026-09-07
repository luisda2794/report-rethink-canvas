import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { submitLeadReclutamiento } from "@/lib/leads-public.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/reclutamiento")({
  component: ReclutamientoPage,
  head: () => ({
    meta: [
      { title: "Trabaja como repartidor — Menssajero" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-md mx-auto px-6 py-12">
        <div className="mb-8 text-center">
          <div className="text-[11px] tracking-wide text-muted-foreground uppercase">Menssajero</div>
          <h1 className="text-2xl font-semibold mt-1">Únete como repartidor</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReclutamientoPage() {
  const submit = useServerFn(submitLeadReclutamiento);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [cp, setCp] = useState("");
  const [consiente, setConsiente] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!nombre.trim() || !telefono.trim()) {
      setError("Completa nombre y teléfono.");
      return;
    }
    if (!consiente) {
      setError("Tenés que aceptar el tratamiento de tus datos para continuar.");
      return;
    }
    setSubmitting(true);
    try {
      await submit({
        data: {
          nombre: nombre.trim(),
          telefono: telefono.trim(),
          codigo_postal: cp.trim() || null,
          consentimiento: true,
        },
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar. Probá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Shell>
        <div className="text-center py-8">
          <div className="size-14 bg-success/15 border border-success/30 rounded-full grid place-items-center mx-auto mb-4">
            <Check className="size-7 text-success" />
          </div>
          <h2 className="text-lg font-semibold mb-2">¡Gracias!</h2>
          <p className="text-sm text-muted-foreground">Recibimos tus datos — te vamos a contactar en breve.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={handleSubmit} className="bg-card border rounded-lg p-5 space-y-4">
        <p className="text-sm text-muted-foreground">
          Dejanos tus datos y te contactamos para contarte de las oportunidades de colaboración como repartidor.
        </p>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Nombre</span>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </label>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Teléfono</span>
          <Input type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+34..." required />
        </label>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Código postal</span>
          <Input value={cp} onChange={(e) => setCp(e.target.value)} placeholder="28001" maxLength={10} />
        </label>

        <label className="flex items-start gap-2.5 pt-1">
          <Checkbox checked={consiente} onCheckedChange={(v) => setConsiente(v === true)} className="mt-0.5" />
          <span className="text-xs text-muted-foreground leading-relaxed">
            Acepto que mis datos sean tratados para ser contactado sobre oportunidades de colaboración como repartidor.
          </span>
        </label>

        {error && (
          <div className="px-3 py-2 bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded flex items-start gap-2">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" disabled={submitting || !consiente} className="w-full gap-2">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {submitting ? "Enviando…" : "Enviar"}
        </Button>
      </form>
    </Shell>
  );
}
