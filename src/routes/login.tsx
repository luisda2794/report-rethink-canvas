import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { firstAllowedRoute } from "@/lib/roles";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Menssajero — Acceso" },
      { name: "description", content: "Accede al panel operativo de Menssajero." },
    ],
  }),
});

function LoginPage() {
  const { user, role, signIn, signUp, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user && role) {
      navigate({ to: firstAllowedRoute(role) as "/" });
    }
  }, [loading, user, role, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    if (mode === "login") {
      const { error } = await signIn(email.trim(), password);
      if (error) setError(error === "Invalid login credentials" ? "Credenciales inválidas." : error);
    } else {
      const { error } = await signUp(email.trim(), password, fullName.trim());
      if (error) setError(error);
      else setInfo("Cuenta creada. Revisa tu email para confirmar (si tu admin aún no lo ha desactivado).");
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 font-syne bg-background">
      <div className="bg-[#1c1c2e] text-white px-8 lg:px-14 py-10 lg:py-14 flex flex-col justify-between relative overflow-hidden">
        <div className="flex items-center gap-2.5">
          <div className="size-9 bg-electric flex items-center justify-center rounded-md">
            <span className="font-playfair italic font-extrabold text-white text-xl leading-none">M</span>
          </div>
          <span className="font-playfair italic font-extrabold tracking-tight text-xl">
            Men<span className="text-electric">s</span>sajero
          </span>
        </div>

        <div className="relative z-10 max-w-md">
          <div className="font-mono text-[10px] tracking-[0.25em] text-white/40 uppercase mb-5 flex items-center gap-2">
            <span className="size-1 bg-electric rounded-full" />
            DSP · Last-mile
          </div>
          <h1 className="text-4xl lg:text-5xl font-syne font-extrabold leading-[0.95] tracking-tighter">
            Operaciones last-mile,
            <br />
            <span className="font-playfair italic font-medium text-electric normal-case tracking-normal">
              automatizadas.
            </span>
          </h1>
          <p className="mt-6 text-white/60 text-sm">
            El primer usuario que se registra se convierte automáticamente en administrador.
          </p>
        </div>

        <div className="font-mono text-[10px] text-white/30 tracking-widest uppercase">
          © {new Date().getFullYear()} Menssajero
        </div>
      </div>

      <div className="flex items-center justify-center px-6 lg:px-14 py-12">
        <form onSubmit={onSubmit} className="w-full max-w-sm">
          <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4">
            {mode === "login" ? "Acceso" : "Alta de cuenta"}
          </div>
          <h2 className="font-playfair italic font-extrabold text-4xl lg:text-5xl text-ink leading-tight mb-2">
            {mode === "login" ? "Bienvenido de vuelta" : "Crea tu cuenta"}
          </h2>
          <p className="text-muted-text text-sm mb-8">
            {mode === "login"
              ? "Introduce tus credenciales para acceder al panel operativo."
              : "Indica tus datos. Si eres el primer usuario serás administrador."}
          </p>

          {mode === "signup" && (
            <label className="block mb-4">
              <span className="font-mono text-[10px] text-muted-text tracking-widest uppercase block mb-2">
                Nombre completo
              </span>
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-11 px-3 bg-surface border border-hairline rounded-md text-ink font-syne text-sm focus:outline-none focus:border-electric focus:ring-1 focus:ring-electric"
              />
            </label>
          )}

          <label className="block mb-4">
            <span className="font-mono text-[10px] text-muted-text tracking-widest uppercase block mb-2">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 px-3 bg-surface border border-hairline rounded-md text-ink font-syne text-sm focus:outline-none focus:border-electric focus:ring-1 focus:ring-electric"
              placeholder="tu@menssajero.com"
            />
          </label>

          <label className="block mb-6">
            <span className="font-mono text-[10px] text-muted-text tracking-widest uppercase block mb-2">
              Contraseña
            </span>
            <input
              type="password"
              required
              minLength={mode === "signup" ? 8 : undefined}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-3 bg-surface border border-hairline rounded-md text-ink font-syne text-sm focus:outline-none focus:border-electric focus:ring-1 focus:ring-electric"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <div className="mb-5 px-3 py-2.5 border-l-2 border-danger bg-danger/10 text-danger font-mono text-xs rounded-r flex items-center gap-2">
              <AlertCircle className="size-3.5 shrink-0" /> {error}
            </div>
          )}
          {info && (
            <div className="mb-5 px-3 py-2.5 border-l-2 border-success bg-success/10 text-success font-mono text-xs rounded-r">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 h-11 px-6 text-sm font-semibold tracking-tight bg-electric text-white rounded-md hover:brightness-110 transition-all disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : (
              <>{mode === "login" ? "Entrar al panel" : "Crear cuenta"} <ArrowRight className="size-4" /></>
            )}
          </button>

          <button
            type="button"
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); setInfo(null); }}
            className="mt-6 text-[11px] text-muted-text font-mono tracking-wide hover:text-ink"
          >
            {mode === "login" ? "¿Sin cuenta? Crear una" : "¿Ya tienes cuenta? Acceder"}
          </button>
        </form>
      </div>
    </div>
  );
}
