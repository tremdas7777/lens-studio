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

// POST /api/public/checkout — cria o pedido e a cobrança (Pix ou cartão). O valor é recalculado no servidor.
export const Route = createFileRoute("/api/public/checkout")({
  server: {
    handlers: {
      POST: handler(async ({ request }) => {
        const meta = clientMeta(request);
        if (!rateLimit(`checkout:${meta.ip ?? "?"}`, 8, 10 * 60 * 1000)) {
          return fail(429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
        }
        const { checkoutSchema, createOrder } = await import("@/lib/orders.server");
        const body = checkoutSchema.parse(await readJson(request, 64_000));
        const o = await createOrder(body, { ...meta, origin: publicOrigin(request) });
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
