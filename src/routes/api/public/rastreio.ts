import { createFileRoute } from "@tanstack/react-router";
import { clientMeta, fail, handler, json, rateLimit } from "@/lib/http.server";
import { RASTREIO_STEPS, computeStatus } from "@/lib/rastreio";

// GET /api/public/rastreio?pedido=HB-2610-12345&cpf=00000000000
// Número do pedido + CPF do titular (os dois precisam bater). Port do rastreio da loja de origem.
export const Route = createFileRoute("/api/public/rastreio")({
  server: {
    handlers: {
      GET: handler(async ({ request }) => {
        const { ip } = clientMeta(request);
        if (!rateLimit(`rastreio:${ip ?? "?"}`, 30, 10 * 60 * 1000)) {
          return fail(429, "Muitas consultas. Aguarde alguns minutos.");
        }
        const url = new URL(request.url);
        const number = (url.searchParams.get("pedido") ?? "").trim().toUpperCase();
        const cpf = (url.searchParams.get("cpf") ?? "").replace(/\D/g, "");
        if (!/^HB-\d{4}-\d{5}$/.test(number))
          return fail(400, "Número do pedido inválido. Ex.: HB-2610-12345.");
        if (cpf.length !== 11) return fail(400, "CPF inválido. Digite os 11 números.");
        const { isSupabaseConfigured } = await import("@/lib/db.server");
        if (!isSupabaseConfigured()) return fail(503, "Consulta indisponível no momento.");
        const { getOrderByNumber, refreshOrder } = await import("@/lib/orders.server");
        const found = await getOrderByNumber(number);
        if (!found || found.customer?.cpf !== cpf) {
          return fail(404, "Não encontramos um pedido com esse número e CPF.");
        }
        const o = await refreshOrder(found);
        const status =
          o.status === "paid" ? computeStatus(o.paid_at ?? o.updated_at) : "aguardando_pagamento";
        const rastro = (o.report_result as { rastro?: { trackingCode?: string } } | null)?.rastro;
        return json({
          ok: true,
          number: o.number,
          status,
          paid: o.status === "paid",
          createdAt: o.created_at,
          paidAt: o.paid_at,
          updatedAt: o.updated_at,
          trackingCode: rastro?.trackingCode ?? null,
          eta: o.totals?.frete?.eta ?? null,
          steps: RASTREIO_STEPS,
          items: (o.items ?? []).map((i) => ({ name: i.name, qty: i.qty })),
        });
      }),
    },
  },
});
