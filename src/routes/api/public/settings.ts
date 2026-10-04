import { createFileRoute } from "@tanstack/react-router";
import { handler, json } from "@/lib/http.server";

// GET /api/public/settings — configurações públicas da loja (só o ID do pixel, nunca tokens).
export const Route = createFileRoute("/api/public/settings")({
  server: {
    handlers: {
      GET: handler(async () => {
        const { getMetaConfig } = await import("@/lib/meta.server");
        const c = await getMetaConfig().catch(() => null);
        return json({ ok: true, metaPixelId: c?.pixelId ?? null });
      }),
    },
  },
});
