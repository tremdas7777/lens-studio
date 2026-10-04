import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { clientMeta, handler, json, readJson } from "@/lib/http.server";
import { FUNNEL_EVENT_TYPES, insertFunnelEvent } from "@/lib/funnel.server";

const eventSchema = z.object({
  sessionId: z.string().regex(/^[\w-]{8,64}$/),
  type: z.enum(FUNNEL_EVENT_TYPES),
  path: z.string().max(300).optional(),
  productId: z.string().max(80).optional(),
  productName: z.string().max(200).optional(),
  value: z.number().min(0).max(1_000_000).optional(),
  referrer: z.string().max(500).optional(),
  utm: z.record(z.string().max(40), z.string().max(300).nullable()).optional(),
  metadata: z
    .record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean(), z.null()]))
    .optional(),
});

// POST /api/public/event — visitas/produto/checkout para o Funil do /admin (port do trackEvent da loja de origem,
// agora gravado pelo servidor em vez de insert anônimo direto no Supabase).
export const Route = createFileRoute("/api/public/event")({
  server: {
    handlers: {
      POST: handler(async ({ request }) => {
        const d = eventSchema.parse(await readJson(request, 8_000));
        await insertFunnelEvent({
          session_id: d.sessionId,
          event_type: d.type,
          path: d.path ?? null,
          bundle_id: d.productId ?? null,
          bundle_name: d.productName ?? null,
          value: d.value ?? null,
          referrer: d.referrer || null,
          user_agent: clientMeta(request).ua,
          utm: d.utm,
          metadata: d.metadata ?? null,
        });
        return json({ ok: true });
      }),
    },
  },
});
