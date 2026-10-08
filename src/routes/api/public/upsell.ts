import { createFileRoute } from "@tanstack/react-router";
import {
  clientMeta,
  fail,
  handler,
  json,
  publicOrigin,
  rateLimit,
  readJson,
} from "@/lib/http.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ofertas pós-compra do pedido principal.
// GET  /api/public/upsell?id=<pedido> — ofertas com preços do servidor (kit 50% OFF, seguro, entrega prioritária).
// POST /api/public/upsell — cobra a etapa escolhida (Pix novo ou o mesmo cartão). Mesmo formato do checkout.
export const Route = createFileRoute("/api/public/upsell")({
  server: {
    handlers: {
      GET: handler(async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!UUID.test(id)) return fail(400, "Pedido inválido.");
        const { isSupabaseConfigured } = await import("@/lib/db.server");
        if (!isSupabaseConfigured()) return fail(503, "Indisponível no momento.");
        const { upsellOffers } = await import("@/lib/upsell.server");
        return json(await upsellOffers(id));
      }),
      POST: handler(async ({ request }) => {
        const meta = clientMeta(request);
        if (!rateLimit(`upsell:${meta.ip ?? "?"}`, 8, 10 * 60 * 1000)) {
          return fail(429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
        }
        const { upsellSchema, createUpsellOrder } = await import("@/lib/upsell.server");
        const body = upsellSchema.parse(await readJson(request, 8_000));
        const o = await createUpsellOrder(body, { ...meta, origin: publicOrigin(request) });
        return json({
          ok: true,
          orderId: o.orderId,
          number: o.number,
          method: o.method,
          status: o.status,
          paid: o.paid,
          qrcode: o.qrcode,
          amount: o.amount,
          amountCents: o.amountCents,
          expiresAt: o.expiresAt,
          totals: o.totals,
          items: o.items.map((i) => ({
            kind: i.kind,
            id: i.id,
            name: i.name,
            qty: i.qty,
            price: i.unitPrice,
            meta: i.meta,
          })),
        });
      }),
    },
  },
});
