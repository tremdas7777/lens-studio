import { createFileRoute } from "@tanstack/react-router";

// Notificação da SagacePay ({ event: "sale.paid", data: { id, ... } }).
// O corpo não é confiável: usamos só o id da venda e sempre confirmamos o status em
// GET /sales/:id (com a nossa API key) antes de reportar a venda.
export const Route = createFileRoute("/api/public/sagacepay-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body = (await request.json().catch(() => null)) as any;
        const rawId = body?.data?.id ?? body?.id ?? body?.sale?.id;
        const id = rawId == null ? "" : String(rawId);
        console.log("sagacepay-webhook", body?.event, id);
        if (!/^[\w-]{1,64}$/.test(id)) return Response.json({ ok: true });
        try {
          const { getOrderByGatewayId, reportPaidOnce } = await import("@/lib/orders.server");
          const { checkCharge } = await import("@/lib/gateway.server");
          const { encodeGatewayRef } = await import("@/lib/gateway-id");
          const order = await getOrderByGatewayId(encodeGatewayRef("sagacepay", id));
          if (!order?.gateway_id) return Response.json({ ok: true });
          const { paid, amount } = await checkCharge(order.gateway_id);
          if (paid) await reportPaidOnce(order.id, amount);
        } catch (e) {
          console.error("sagacepay-webhook failed", e);
        }
        return Response.json({ ok: true });
      },
    },
  },
});
