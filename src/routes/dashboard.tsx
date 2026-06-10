import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { Dashboard } from "@/components/dashboard";

export const Route = createFileRoute("/dashboard")({
  component: () => (
    <RequireAuth path="/dashboard">
      <Dashboard />
    </RequireAuth>
  ),
  head: () => ({
    meta: [{ title: "Dashboard — Menssajero" }],
  }),
});
