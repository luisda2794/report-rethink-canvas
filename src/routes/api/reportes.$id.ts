import { createFileRoute } from "@tanstack/react-router";

const API_BASE = "https://menssajero-api-production.up.railway.app";

export const Route = createFileRoute("/api/reportes/$id")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const upstream = await fetch(`${API_BASE}/reporte/${params.id}`, {
          method: "POST",
          body: request.body,
          // @ts-expect-error - duplex required when forwarding a stream body
          duplex: "half",
          headers: {
            "content-type": request.headers.get("content-type") ?? "",
          },
        });
        const headers = new Headers();
        const passthrough = ["content-type", "content-disposition", "content-length"];
        for (const h of passthrough) {
          const v = upstream.headers.get(h);
          if (v) headers.set(h, v);
        }
        return new Response(upstream.body, {
          status: upstream.status,
          headers,
        });
      },
    },
  },
});
