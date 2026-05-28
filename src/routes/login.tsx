import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

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
  const { user, signIn, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/reportes" });
  }, [loading, user, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) setError(error === "Invalid login credentials" ? "Credenciales inválidas." : error);
    else navigate({ to: "/reportes" });
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 font-syne bg-background">
      {/* LEFT */}
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
            DSP · Cainiao · Last-mile
          </div>
          <h1 className="text-4xl lg:text-5xl font-syne font-extrabold leading-[0.95] tracking-tighter">
            Operaciones
            <br />
            last-mile,
            <br />
            <span className="font-playfair italic font-medium text-electric normal-case tracking-normal">
              automatizadas.
            </span>
          </h1>

          <div className="grid grid-cols-2 gap-px bg-white/10 border border-white/10 mt-10 rounded-lg overflow-hidden">
            {[
              { k: "DSR", v: "90%", d: "Tasa entrega" },
              { k: "CD6", v: "99.5%", d: "Plazo crítico" },
              { k: "KPIs", v: "4", d: "Auto-generados" },
              { k: "ERR", v: "0", d: "Procesado limpio" },
            ].map((s) => (
              <div key={s.k} className="bg-[#1c1c2e] p-5">
                <div className="font-playfair italic font-extrabold text-electric text-2xl leading-none mb-2">
                  {s.k}
                </div>
                <div className="font-mono text-lg">{s.v}</div>
                <div className="font-mono text-[9px] text-white/40 tracking-widest uppercase mt-1">
                  {s.d}
                </div>
              </div>
            ))}
          </div>

          <ul className="mt-10 space-y-2.5 text-sm text-white/70">
            {[
              "Reportes Cainiao listos en un click",
              "Conciliación de facturación automatizada",
              "Multi-hub, multi-marca",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="size-1.5 bg-electric rounded-full mt-2 shrink-0" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="font-mono text-[10px] text-white/30 tracking-widest uppercase">
          © {new Date().getFullYear()} Menssajero
        </div>
      </div>

      {/* RIGHT */}
      <div className="flex items-center justify-center px-6 lg:px-14 py-12">
        <form onSubmit={onSubmit} className="w-full max-w-sm">
          <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-4">
            Acceso
          </div>
          <h2 className="font-playfair italic font-extrabold text-4xl lg:text-5xl text-ink leading-tight mb-2">
            Bienvenido <span className="text-electric">de vuelta</span>
          </h2>
          <p className="text-muted-text text-sm mb-10">
            Introduce tus credenciales para acceder al panel operativo.
          </p>

          <label className="block mb-5">
            <span className="font-mono text-[10px] text-muted-text tracking-widest uppercase block mb-2">
              Email
            </span>
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
              autoComplete="current-password"
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

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 h-11 px-6 text-sm font-semibold tracking-tight bg-electric text-white rounded-md hover:brightness-110 transition-all disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <>Entrar al panel <ArrowRight className="size-4" /></>}
          </button>

          <p className="mt-6 text-[11px] text-muted-text font-mono tracking-wide">
            ¿Sin acceso? Solicítaselo a tu administrador.
          </p>
        </form>
      </div>
    </div>
  );
}
