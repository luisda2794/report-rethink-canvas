import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileSpreadsheet, Activity, Users } from "lucide-react";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: "Menssajero — Inteligencia operativa para flotas last-mile" },
      {
        name: "description",
        content:
          "Reportes KPI, riesgo operativo y pre flow automáticos para DSPs de Cainiao. Sube tu ePOD y descarga cada reporte listo para enviar.",
      },
      { property: "og:title", content: "Menssajero — Inteligencia operativa" },
      { property: "og:description", content: "Reportes KPI y operativos para DSPs de Cainiao." },
    ],
  }),
});

const FEATURES = [
  {
    icon: FileSpreadsheet,
    title: "Reportes automáticos desde ePOD",
    desc: "Sube tu Excel de Cainiao una vez y genera cada reporte por separado, sin retoques manuales.",
  },
  {
    icon: Activity,
    title: "KPIs Cainiao en tiempo real",
    desc: "DSR, CD4, CD6 y OOH con los formatos y umbrales exactos que pide Cainiao cada semana.",
  },
  {
    icon: Users,
    title: "Pre Flow Meeting por repartidor",
    desc: "PUDO, puntos y paquetes del día listos para tu reunión operativa de la mañana.",
  },
];

const TARGETS = [
  { code: "DSR", value: "≥ 90%", desc: "Tasa de entrega" },
  { code: "CD6", value: "≥ 99.5%", desc: "Plazo crítico" },
  { code: "CD4", value: "Preventivo", desc: "Alerta temprana" },
  { code: "OOH", value: "≥ 95%", desc: "Out of Home" },
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-syne">
      {/* NAV */}
      <header className="border-b border-hairline">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="size-8 bg-electric flex items-center justify-center rounded-md">
              <span className="font-playfair italic font-extrabold text-white text-lg leading-none">
                M
              </span>
            </div>
            <span className="font-playfair italic font-extrabold tracking-tight text-lg text-ink">
              Men<span className="text-electric">s</span>sajero
            </span>
          </div>
          <Link
            to="/reportes"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold tracking-tight bg-ink text-white rounded-md hover:bg-ink/90 transition-colors"
          >
            Acceder al panel
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="px-6 lg:px-10 pt-24 lg:pt-32 pb-24">
        <div className="max-w-5xl mx-auto">
          <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-6 flex items-center gap-2">
            <span className="size-1 bg-electric rounded-full" />
            DSP · Cainiao · Last-mile
          </div>
          <h1 className="text-6xl lg:text-8xl font-syne font-extrabold leading-[0.9] text-ink tracking-tighter uppercase text-balance">
            Inteligencia
            <br />
            operativa para
            <br />
            <span className="font-playfair italic font-medium text-electric normal-case tracking-normal">
              flotas last-mile
            </span>
          </h1>
          <p className="mt-8 text-muted-text text-pretty max-w-[60ch] text-lg leading-relaxed">
            Reportes KPI, riesgo operativo y pre flow automáticos para DSPs de
            Cainiao. Sube tu ePOD y descarga cada reporte listo para enviar.
          </p>
          <div className="mt-10">
            <Link
              to="/reportes"
              className="inline-flex items-center gap-2 px-6 py-3 text-base font-semibold tracking-tight bg-electric text-white rounded-md hover:brightness-110 transition-all"
            >
              Acceder al panel
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="px-6 lg:px-10 py-24 border-t border-hairline">
        <div className="max-w-6xl mx-auto">
          <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-10">
            Qué hace Menssajero
          </div>
          <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title}>
                <div className="size-10 bg-surface-2 rounded-md flex items-center justify-center mb-5 ring-1 ring-hairline">
                  <Icon className="size-5 text-electric" strokeWidth={1.75} />
                </div>
                <h3 className="font-syne font-bold text-xl text-ink mb-2 tracking-tight">
                  {title}
                </h3>
                <p className="text-muted-text text-[15px] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TARGETS */}
      <section className="px-6 lg:px-10 py-24 border-t border-hairline bg-surface">
        <div className="max-w-6xl mx-auto">
          <div className="font-mono text-[10px] tracking-[0.25em] text-muted-text uppercase mb-10">
            KPI Targets · Cainiao
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden">
            {TARGETS.map((t) => (
              <div key={t.code} className="bg-background p-8">
                <div className="font-playfair italic font-extrabold text-electric text-4xl mb-3 leading-none">
                  {t.code}
                </div>
                <div className="font-mono text-2xl text-ink tracking-tight">
                  {t.value}
                </div>
                <div className="font-mono text-[10px] text-muted-text tracking-widest uppercase mt-2">
                  {t.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-hairline px-6 lg:px-10 py-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="font-playfair italic font-extrabold tracking-tight text-base text-ink">
            Men<span className="text-electric">s</span>sajero
          </span>
          <span className="font-mono text-[10px] text-muted-text tracking-widest uppercase">
            © {new Date().getFullYear()}
          </span>
        </div>
      </footer>
    </div>
  );
}
