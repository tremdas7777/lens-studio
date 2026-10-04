import { createFileRoute } from "@tanstack/react-router";
import { clientMeta, fail, handler, json, rateLimit, readJson } from "@/lib/http.server";

// POST /api/public/checkout — cria o pedido e a cobrança Pix. O valor é recalculado no servidor.
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

/** Domínio público onde o cliente está comprando: Origin do navegador (já validado como mesma
 * origem), depois cabeçalhos do proxy, por fim a própria URL da requisição. */
function publicOrigin(request: Request): string {
  const o = request.headers.get("origin");
  if (o && /^https?:\/\//.test(o)) return o;
  const host = request.headers.get("x-forwarded-host");
  if (host) return `${request.headers.get("x-forwarded-proto") ?? "https"}://${host.split(",")[0]!.trim()}`;
  return new URL(request.url).origin;
}
