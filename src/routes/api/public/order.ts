import { createFileRoute } from "@tanstack/react-router";
import { clientMeta, fail, handler, json } from "@/lib/http.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/public/order?id=<orderId> — status público do pedido (polling da página de confirmação).
// Confere o pagamento no gateway e, se pago, marca e dispara Meta CAPI + UTMify uma única vez.
export const Route = createFileRoute("/api/public/order")({
  server: {
    handlers: {
      GET: handler(async ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id") ?? "";
        if (!UUID.test(id)) return fail(400, "Pedido inválido.");
        const { isSupabaseConfigured } = await import("@/integrations/supabase/client.server");
        if (!isSupabaseConfigured()) return fail(503, "Consulta indisponível no momento.");
        const { getOrder, refreshOrder, publicOrder } = await import("@/lib/orders.server");
        const order = await getOrder(id);
        if (!order) return fail(404, "Pedido não encontrado.");
        const { ip, ua } = clientMeta(request);
        const fresh = await refreshOrder(order, {
          fbp: url.searchParams.get("fbp")?.slice(0, 200) || undefined,
          fbc: url.searchParams.get("fbc")?.slice(0, 300) || undefined,
          url: request.headers.get("referer")?.slice(0, 1000) || undefined,
          ip,
          ua,
        });
        return json(publicOrder(fresh));
      }),
    },
  },
});
