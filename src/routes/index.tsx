import { createFileRoute } from "@tanstack/react-router";
import { FileSpreadsheet, Activity, Users } from "lucide-react";
import { Header } from "@/components/header";
import { HeroSection } from "@/components/hero";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: "Menssajero — Inteligencia operativa para flotas last-mile" },
      {
        name: "description",
        content:
          "Reportes KPI, riesgo operativo y pre flow automáticos para DSPs. Sube tu ePOD y descarga cada reporte listo para enviar.",
      },
      { property: "og:title", content: "Menssajero — Inteligencia operativa" },
      { property: "og:description", content: "Reportes KPI y operativos para DSPs." },
    ],
  }),
});

const FEATURES = [
  {
    icon: FileSpreadsheet,
    title: "Reportes automáticos desde ePOD",
    desc: "Sube tu Excel una vez y genera cada reporte por separado, sin retoques manuales.",
  },
  {
    icon: Activity,
    title: "KPIs en tiempo real",
    desc: "DSR, CD4, CD6 y OOH con los formatos y umbrales exactos que se piden cada semana.",
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
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <HeroSection />

      {/* FEATURES */}
      <section id="features" className="px-6 lg:px-10 py-24 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <div className="font-mono text-[10px] tracking-[0.25em] text-muted-foreground uppercase mb-10">
            Qué hace Menssajero
          </div>
          <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title}>
                <div className="size-10 bg-muted rounded-md flex items-center justify-center mb-5 ring-1 ring-border">
                  <Icon className="size-5" strokeWidth={1.75} />
                </div>
                <h3 className="font-semibold text-xl mb-2 tracking-tight">{title}</h3>
                <p className="text-muted-foreground text-[15px] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TARGETS */}
      <section className="px-6 lg:px-10 py-24 border-t border-border bg-muted/30">
        <div className="max-w-5xl mx-auto">
          <div className="font-mono text-[10px] tracking-[0.25em] text-muted-foreground uppercase mb-10">
            KPI Targets
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border rounded-lg overflow-hidden">
            {TARGETS.map((t) => (
              <div key={t.code} className="bg-background p-8">
                <div className="font-bold text-4xl mb-3 leading-none">{t.code}</div>
                <div className="font-mono text-2xl tracking-tight">{t.value}</div>
                <div className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase mt-2">
                  {t.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border px-6 lg:px-10 py-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="font-semibold tracking-tight text-base">Menssajero</span>
          <span className="font-mono text-[10px] text-muted-foreground tracking-widest uppercase">
            © {new Date().getFullYear()}
          </span>
        </div>
      </footer>
    </div>
  );
}
