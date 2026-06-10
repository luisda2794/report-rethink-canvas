import { createFileRoute } from "@tanstack/react-router";
import { HeroSection } from "@/components/hero";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: "Menssajero — Inicia sesión" },
      {
        name: "description",
        content: "Accede al panel operativo de Menssajero.",
      },
    ],
  }),
});

function LandingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <HeroSection />
    </div>
  );
}
