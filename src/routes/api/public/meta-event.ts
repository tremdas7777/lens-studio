import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { clientMeta, handler, json, readJson } from "@/lib/http.server";

const schema = z.object({
  eventName: z.enum(["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo"]),
  eventId: z.string().min(6).max(80),
  url: z.string().url().max(1000),
  fbp: z.string().max(200).nullable().optional(),
  fbc: z.string().max(300).nullable().optional(),
  value: z.number().min(0).max(1_000_000).optional(),
  contentName: z.string().max(200).optional(),
  contentIds: z.array(z.string().max(80)).max(30).optional(),
});

// POST /api/public/meta-event — espelho servidor (Conversions API) dos eventos do pixel do navegador,
// com o mesmo event_id para deduplicação. Port do trackMetaEvent da loja de origem.
export const Route = createFileRoute("/api/public/meta-event")({
  server: {
    handlers: {
      POST: handler(async ({ request }) => {
        const d = schema.parse(await readJson(request, 8_000));
        const { sendCapiEvent } = await import("@/lib/meta.server");
        await sendCapiEvent({
          eventName: d.eventName,
          eventId: d.eventId,
          url: d.url,
          user: { ...clientMeta(request), fbp: d.fbp, fbc: d.fbc },
          customData:
            d.value !== undefined || d.contentIds
              ? {
                  value: d.value,
                  currency: "BRL",
                  content_name: d.contentName,
                  content_ids: d.contentIds,
                  content_type: "product",
                }
              : undefined,
        });
        return json({ ok: true });
      }),
    },
  },
});
