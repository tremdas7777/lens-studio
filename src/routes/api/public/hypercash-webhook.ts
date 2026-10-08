import { createFileRoute } from "@tanstack/react-router";

// Notificação da HyperCash (cartão). O corpo não é confiável: usamos só o id da transação e
// sempre confirmamos o status em GET /transactions/:id (com a nossa chave secreta) antes de
// reportar a venda.
export const Route = createFileRoute("/api/public/hypercash-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body = (await request.json().catch(() => null)) as any;
        // O id da transação pode vir em lugares diferentes conforme a versão do postback.
        const ids = [
          body?.data?.id,
          body?.objectId,
          body?.transaction?.id,
          body?.transaction_id,
          body?.id,
        ]
          .filter((v) => v != null)
          .map(String)
          .filter((v, i, a) => /^[\w-]{1,64}$/.test(v) && a.indexOf(v) === i);
        console.log("hypercash-webhook", body?.type ?? body?.event, ids.join(","));
        try {
          const { getOrderByGatewayId, refreshOrder } = await import("@/lib/orders.server");
          const { encodeGatewayRef } = await import("@/lib/gateway-id");
          for (const id of ids) {
            const order = await getOrderByGatewayId(encodeGatewayRef("hypercash", id));
            if (!order) continue;
            // Confere no gateway e marca pago (reportando uma única vez) ou recusado.
            await refreshOrder(order);
            break;
          }
        } catch (e) {
          console.error("hypercash-webhook failed", e);
        }
        return Response.json({ ok: true });
      },
    },
  },
});
