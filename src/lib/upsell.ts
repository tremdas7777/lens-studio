/**
 * Ofertas pós-compra (mesma lógica da AiDEX), cobradas à parte do pedido principal:
 *   1) tela de ofertas: "kit" (o mesmo plano/produto do pedido com 50% OFF) e/ou "seguro" de entrega,
 *      numa cobrança só;
 *   2) depois, página própria da "expresso" (entrega prioritária), cobrança separada.
 * Compra no cartão → no mesmo cartão, com o clique do cliente; compra no Pix → um Pix novo.
 * Preços definidos aqui (servidor); a tela só exibe o que /api/public/upsell devolve.
 */
import type { OrderItem } from "@/lib/db-types";

export const UPSELL_DISCOUNT = 0.5;

export const UPSELL_PRODUCTS = ["kit", "seguro", "expresso"] as const;
export type UpsellProduct = (typeof UPSELL_PRODUCTS)[number];

/** Seguro de entrega: reenvio ou reembolso em caso de extravio ou dano no transporte. */
export const SHIPPING_INSURANCE = {
  id: "seguro-entrega",
  name: "Seguro de entrega",
  price: 29.9,
} as const;

/** Entrega prioritária: o pedido é despachado na frente, por envio expresso. */
export const EXPRESS_SHIPPING = {
  id: "entrega-prioritaria",
  name: "Entrega prioritária",
  price: 19.9,
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Item oferecido de novo com 50% OFF: o mesmo plano de lentes (com o mesmo grau) ou, num pedido
 * sem lentes, o item mais caro. A oferta do checkout (order bump) nunca entra.
 */
export function upsellKit(items: readonly OrderItem[]): OrderItem | null {
  const own = items.filter((i) => i.kind !== "servico" && !i.details?.["bump"]);
  const pick =
    own.find((i) => i.kind === "lente") ?? [...own].sort((a, b) => b.unitPrice - a.unitPrice)[0];
  if (!pick) return null;
  return {
    ...pick,
    qty: 1,
    unitPrice: round2(pick.unitPrice * (1 - UPSELL_DISCOUNT)),
    meta: [...pick.meta, `Oferta pós-compra: ${Math.round(UPSELL_DISCOUNT * 100)}% OFF`],
    details: { ...pick.details, upsell: true, compareAt: pick.unitPrice },
  };
}

const service = (s: { id: string; name: string; price: number }): OrderItem => ({
  kind: "servico",
  id: s.id,
  name: s.name,
  qty: 1,
  unitPrice: s.price,
  meta: [],
  details: {},
});

/**
 * O que o cliente escolheu numa etapa do pós-compra, numa cobrança só (preços do servidor).
 * Itens repetidos ou desconhecidos são ignorados; a ordem segue UPSELL_PRODUCTS.
 */
export function upsellSelection(parentItems: readonly OrderItem[], chosen: readonly string[]) {
  const products: UpsellProduct[] = [];
  const items: OrderItem[] = [];
  for (const p of UPSELL_PRODUCTS) {
    if (!chosen.includes(p)) continue;
    const item =
      p === "kit"
        ? upsellKit(parentItems)
        : service(p === "seguro" ? SHIPPING_INSURANCE : EXPRESS_SHIPPING);
    if (!item) continue;
    products.push(p);
    items.push(item);
  }
  const total = round2(items.reduce((s, i) => s + i.unitPrice * i.qty, 0));
  const label = items
    .map((i, k) => (products[k] === "kit" ? `${i.name} (50% OFF)` : i.name))
    .join(" + ");
  return { products, items, total, label };
}
