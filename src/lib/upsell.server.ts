// Ofertas pós-compra (kit 50% OFF + seguro; depois entrega prioritária). Somente servidor.
// Cada etapa vira um pedido próprio (tabela orders, totals.upsell = pedido principal), cobrado
// com a mesma lógica do checkout: Pix novo ou o mesmo cartão (token do SDK guardado só na aba).
import { z } from "zod";
import type { OrderRow, OrderTotals } from "@/lib/db-types";
import { isCardRef } from "@/lib/gateway-id";
import { HttpError } from "@/lib/http.server";
import {
  chargeOrder,
  getOrder,
  insertOrder,
  preparePayment,
  refreshOrder,
  type CreatedOrder,
  type NewOrder,
} from "@/lib/orders.server";
import { maxInstallments } from "@/lib/pricing";
import {
  EXPRESS_SHIPPING,
  SHIPPING_INSURANCE,
  UPSELL_DISCOUNT,
  UPSELL_PRODUCTS,
  upsellKit,
  upsellSelection,
} from "@/lib/upsell";

async function db() {
  const { supabaseAdmin } = await import("@/lib/db.server");
  return supabaseAdmin;
}

export const upsellSchema = z.object({
  parentId: z.string().uuid(),
  products: z.array(z.enum(UPSELL_PRODUCTS)).min(1).max(UPSELL_PRODUCTS.length),
  payment: z
    .discriminatedUnion("method", [
      z.object({ method: z.literal("pix") }),
      // Token do cartão da compra principal (gerado pelo SDK no checkout; nunca o número).
      z.object({ method: z.literal("card"), cardHash: z.string().min(10).max(4000) }),
    ])
    .default({ method: "pix" }),
  adminPassword: z.string().max(200).optional(),
});
export type UpsellInput = z.infer<typeof upsellSchema>;

const isExpressStep = (products: readonly string[]) => products.includes("expresso");

/** Pedido principal elegível (existe, não é ele mesmo um pós-compra). */
async function mainOrder(id: string): Promise<OrderRow> {
  const o = await getOrder(id);
  if (!o || o.totals?.upsell) throw new HttpError(404, "Pedido não encontrado.");
  return o;
}

/** Cobranças já criadas para uma etapa (ofertas ou entrega prioritária) do pedido principal. */
async function upsellsOf(parentId: string, express: boolean): Promise<OrderRow[]> {
  const { data } = await (
    await db()
  )
    .from("orders")
    .select("*")
    .eq("totals->upsell->>of", parentId)
    .order("created_at", { ascending: false })
    .limit(10);
  return ((data ?? []) as OrderRow[]).filter(
    (o) => isExpressStep(o.totals?.upsell?.products ?? []) === express,
  );
}

const asCreated = (o: OrderRow): CreatedOrder => ({
  orderId: o.id,
  number: o.number,
  method: isCardRef(o.gateway_id) ? "card" : "pix",
  status: o.status,
  paid: o.status === "paid",
  qrcode: o.qrcode,
  amount: o.amount_cents / 100,
  amountCents: o.amount_cents,
  expiresAt: o.expires_at,
  totals: o.totals,
  items: o.items,
});

/** Ofertas para a tela pós-compra (só preços e nomes; nada de dados pessoais). */
export async function upsellOffers(parentId: string) {
  const o = await mainOrder(parentId);
  const kit = upsellKit(o.items);
  return {
    ok: true,
    number: o.number,
    paid: o.status === "paid",
    method: isCardRef(o.gateway_id) ? "card" : "pix",
    discount: UPSELL_DISCOUNT,
    kit: kit && {
      kind: kit.kind,
      id: kit.id,
      name: kit.name,
      meta: kit.meta,
      price: kit.unitPrice,
      compareAt: Number(kit.details["compareAt"] ?? 0),
    },
    seguro: { name: SHIPPING_INSURANCE.name, price: SHIPPING_INSURANCE.price },
    // Quem já escolheu o frete expresso no checkout não vê a entrega prioritária.
    expresso:
      o.totals?.frete?.id === "expresso"
        ? null
        : { name: EXPRESS_SHIPPING.name, price: EXPRESS_SHIPPING.price },
  };
}

/** Cria (ou reaproveita) a cobrança de uma etapa do pós-compra. */
export async function createUpsellOrder(
  data: UpsellInput,
  ctx: { ip: string | null; ua: string | null; origin: string },
): Promise<CreatedOrder> {
  let parent = await mainOrder(data.parentId);
  const express = isExpressStep(data.products);
  if (express && data.products.length > 1) throw new HttpError(422, "Oferta inválida.");
  if (express && parent.totals?.frete?.id === "expresso") {
    throw new HttpError(422, "Seu pedido já tem frete expresso.");
  }
  const card = data.payment.method === "card" ? data.payment : null;
  if (card && !isCardRef(parent.gateway_id)) throw new HttpError(422, "Pague esta oferta com Pix.");
  // Só depois do pagamento do pedido principal confirmado pelo gateway.
  if (parent.status !== "paid") parent = await refreshOrder(parent);
  if (parent.status !== "paid") throw new HttpError(409, "Seu pedido ainda não foi pago.");

  const sel = upsellSelection(parent.items, data.products);
  if (!sel.products.length) throw new HttpError(422, "Escolha uma oferta.");

  // Nunca cobra duas vezes a mesma etapa: devolve a cobrança já paga ou a que ainda está valendo
  // (mesmas ofertas e mesma forma de pagamento; Pix dentro do prazo).
  const same = (o: OrderRow) =>
    [...(o.totals?.upsell?.products ?? [])].sort().join() === [...sel.products].sort().join() &&
    isCardRef(o.gateway_id) === !!card;
  const prev = await upsellsOf(parent.id, express);
  const reuse =
    prev.find((o) => o.status === "paid") ??
    prev.find(
      (o) =>
        o.status === "waiting_payment" &&
        same(o) &&
        (!!card || (!!o.expires_at && new Date(o.expires_at).getTime() > Date.now() + 60_000)),
    );
  if (reuse) return asCreated(reuse);

  // Com o kit, parcela como a compra principal (respeitando a parcela mínima); só serviços, à vista.
  const parentPay = parent.totals?.payment;
  const installments =
    card && sel.products.includes("kit") && parentPay?.method === "card"
      ? Math.min(parentPay.installments, maxInstallments(sel.total))
      : 1;
  const charge = await preparePayment(
    card ? { cardHash: card.cardHash, installments } : null,
    data.adminPassword,
  );

  const totals: OrderTotals = {
    sub: sel.total,
    discount: 0,
    coupon: null,
    pix: 0,
    shipping: 0,
    total: sel.total,
    frete: {
      id: "junto",
      name: `Junto com o pedido ${parent.number}`,
      eta: parent.totals?.frete?.eta ?? "",
      price: 0,
    },
    bump: null,
    payment: card ? { method: "card", installments } : { method: "pix" },
    upsell: { of: parent.id, number: parent.number, products: sel.products },
  };
  const order: NewOrder = {
    customer: parent.customer,
    address: parent.address,
    items: sel.items,
    totals,
    summary: `Pós-compra ${parent.number}: ${sel.label}`.slice(0, 300),
    amountCents: Math.round(sel.total * 100),
    rx: sel.products.includes("kit") ? parent.rx : { method: "nao-precisa" },
    sessionId: parent.session_id,
    utm: parent.utm ?? {},
    fbp: parent.fbp,
    fbc: parent.fbc,
    url: parent.url,
  };
  const createdAt = Date.now();
  const row = await insertOrder(order, ctx, createdAt);
  return chargeOrder(row, order, charge, createdAt, ctx);
}
