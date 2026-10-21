import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { Dashboard } from "@/components/dashboard";
import { CentroDeMando } from "@/components/centro-de-mando";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/dashboard")({
  component: () => (
    <RequireAuth path="/dashboard">
      <Tabs defaultValue="resumen" className="space-y-4">
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="centro-de-mando">Centro de Mando</TabsTrigger>
        </TabsList>
        <TabsContent value="resumen">
          <Dashboard />
        </TabsContent>
        <TabsContent value="centro-de-mando">
          <CentroDeMando />
        </TabsContent>
      </Tabs>
    </RequireAuth>
  ),
  head: () => ({
    meta: [{ title: "Dashboard — Menssajero" }],
  }),
});
