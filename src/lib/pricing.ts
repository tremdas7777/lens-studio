/**
 * Catálogo e preços da Hubble Brasil — fonte única de verdade do valor cobrado.
 *
 * O cliente (public/checkout.html) só EXIBE os valores; o servidor recalcula tudo aqui
 * a partir dos ids enviados. A fórmula é idêntica à do checkout estático:
 *
 *   produtos = Σ (preço unitário × qtd) + order bump
 *   cupom    = arred2(produtos × %cupom)
 *   total    = arred2(produtos − cupom + frete)          (Pix sem desconto: PIX_OFF = 0)
 *
 * Armações, cores e acessórios vêm de catalog.generated.json (gerado de data.js por
 * scripts/gen-catalog.mjs).
 */
import { z } from "zod";
import catalog from "./catalog.generated.json";

type Frame = { name: string; sun: boolean; colors: string[] };
type Accessory = { name: string; price: number };

const FRAMES = catalog.frames as Record<string, Frame>;
const ACCESSORIES = catalog.accessories as Record<string, Accessory>;
export const FRAME_PRICES = catalog.prices as { glasses: number; sunglasses: number };

/** Desconto do Pix. Hoje 0: Pix e cartão custam o mesmo. */
export const PIX_OFF = 0;

/** Cartão: até 12x sem juros, parcela mínima de R$ 30 (mesma regra de HB.installments no site). */
export const MAX_INSTALLMENTS = 12;
export const MIN_INSTALLMENT = 30;
export const maxInstallments = (total: number) =>
  Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(total / MIN_INSTALLMENT)));

/* ---------------- Lentes de contato ---------------- */
export const LENS = { id: "skyhy", name: "SkyHy by Hubble® Diária" } as const;

export const LENS_PLANS = {
  "1m": { label: "1 mês", months: 1, boxes: 2, price: 97 },
  "2m": { label: "2 meses", months: 2, boxes: 4, price: 147 },
  "3m": { label: "3 meses", months: 3, boxes: 6, price: 197 },
} as const;
export type LensPlanId = keyof typeof LENS_PLANS;
const PLAN_IDS = Object.keys(LENS_PLANS) as [LensPlanId, ...LensPlanId[]];

/* ---------------- Óculos ---------------- */
export const GLASSES_ADDONS = { filtroAzul: 220, altoIndice: 165 } as const;

/* ---------------- Order bump / cupons / frete ---------------- */
export const BUMP_FACTOR = 0.6;
export const BUMP_WITH_LENS = "biotrue-hydration-boost-new";
export const BUMP_WITHOUT_LENS = "optiplus-anti-fog-microfiber-cloth";
/** Preço fixo da oferta do checkout (mesmo valor em checkout.html). Sem preço aqui = 60% do preço. */
export const BUMP_PRICES: Record<string, number> = { [BUMP_WITH_LENS]: 37.9 };

/** Loja sem cupons: qualquer código é recusado. Para voltar, adicione aqui (ex.: BEMVINDO10: { code: "BEMVINDO10", pct: 0.1, label: "10% OFF" }). */
export const COUPONS: Record<string, { code: string; pct: number; label: string; min?: number }> = {};

export const FRETES = {
  gratis: { id: "gratis", name: "Frete Grátis", eta: "7 a 10 dias úteis", price: 0 },
  padrao: { id: "padrao", name: "Frete Padrão", eta: "5 dias úteis", price: 20 },
  expresso: { id: "expresso", name: "Frete Express", eta: "1 a 2 dias úteis", price: 37.53 },
} as const;
export type FreteId = keyof typeof FRETES;
/** Frete grátis só para pedidos com produtos (+ oferta) a partir deste valor. */
export const FREE_SHIPPING_MIN = 100;

/* ---------------- Validação dos itens ---------------- */
const qty = z.number().int().min(1).max(10).default(1);

/** Grau esférico no formato do site: "-2.00", "+1.25" (aceita vírgula). */
const sph = z
  .string()
  .trim()
  .transform((v) => v.replace(",", "."))
  .refine((v) => /^[+-]?\d{1,2}\.\d{2}$/.test(v), "Grau inválido")
  .transform((v) => Number(v))
  .refine((n) => Math.abs(n) <= 20 && Math.round(n * 4) === n * 4, "Grau inválido");

const lensEye = z
  .object({ kind: z.enum(["miopia", "hipermetropia"]), sph })
  .refine((e) => (e.kind === "miopia" ? e.sph < 0 : e.sph > 0), {
    message: "Miopia usa grau negativo e hipermetropia, grau positivo.",
  })
  .nullable()
  .optional();

const glassesEye = z
  .object({
    sph: z.string().max(8),
    cyl: z.string().max(8).nullable().optional(),
    axis: z.string().max(4).nullable().optional(),
  })
  .nullable()
  .optional();

export const itemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lente"),
    id: z.literal(LENS.id),
    planId: z.enum(PLAN_IDS),
    od: lensEye,
    oe: lensEye,
    qty,
  }),
  z.object({
    kind: z.literal("oculos"),
    id: z.string().max(60),
    tipo: z.enum(["grau", "sol"]),
    color: z.string().max(60),
    uso: z.enum(["visao-simples", "leitura", "sem-grau"]),
    lente: z.enum(["policarbonato", "alto-indice"]).default("policarbonato"),
    filtroAzul: z.boolean().default(false),
    leitura: z.string().max(8).optional(),
    rx: z.enum(["agora", "depois"]).nullable().optional(),
    od: glassesEye,
    oe: glassesEye,
    dp: z.string().max(4).optional(),
    qty,
  }),
  z.object({ kind: z.literal("acessorio"), id: z.string().max(80), qty }),
]);
export type CartItemInput = z.infer<typeof itemSchema>;

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

export type PricedLine = {
  kind: "lente" | "oculos" | "acessorio";
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  /** Linhas descritivas (plano, cor, grau…) para admin/e-mail/RastroCode. */
  meta: string[];
  /** Dados estruturados validados (grau, cor, opções). */
  details: Record<string, unknown>;
};

const fmtSph = (n: number) => (n > 0 ? "+" : "") + n.toFixed(2).replace(".", ",");

function priceLens(it: Extract<CartItemInput, { kind: "lente" }>): PricedLine {
  const plan = LENS_PLANS[it.planId];
  const od = it.od ?? null;
  const oe = it.oe ?? null;
  // Grau dos dois olhos (ou o mesmo grau nos dois): o plano é sempre para os dois olhos.
  if (!od || !oe) {
    throw new PricingError(
      "Informe o grau dos dois olhos (ou marque “Mesmo grau nos dois olhos”). Volte à página da lente e escolha de novo.",
    );
  }
  const label = { miopia: "Miopia", hipermetropia: "Hipermetropia" } as const;
  const meta: string[] = [];
  if (od) meta.push(`OD: ${label[od.kind]} ${fmtSph(od.sph)}`);
  if (oe) meta.push(`OE: ${label[oe.kind]} ${fmtSph(oe.sph)}`);
  meta.push(`Plano ${plan.label} · ${plan.boxes} caixas de 30 lentes (${plan.months} para cada olho)`);
  return {
    kind: "lente",
    id: LENS.id,
    name: LENS.name,
    qty: it.qty,
    unitPrice: plan.price,
    meta,
    details: { planId: it.planId, months: plan.months, boxes: plan.boxes, od, oe },
  };
}

function priceGlasses(it: Extract<CartItemInput, { kind: "oculos" }>): PricedLine {
  const frame = FRAMES[it.id];
  if (!frame) throw new PricingError("Armação não encontrada.");
  const sun = it.tipo === "sol";
  if (sun && !frame.sun) throw new PricingError(`A armação ${frame.name} não tem versão de sol.`);
  if (!frame.colors.includes(it.color))
    throw new PricingError(`Cor indisponível para ${frame.name}.`);
  if (sun && it.uso === "leitura")
    throw new PricingError("Óculos de sol não têm opção de leitura.");
  if (sun && it.filtroAzul) throw new PricingError("Filtro de luz azul é só para óculos de grau.");
  const base = sun ? FRAME_PRICES.sunglasses : FRAME_PRICES.glasses;
  const unit =
    Math.round(
      (base +
        (it.filtroAzul ? GLASSES_ADDONS.filtroAzul : 0) +
        (it.lente === "alto-indice" ? GLASSES_ADDONS.altoIndice : 0)) *
        100,
    ) / 100;
  const uso = { "visao-simples": "Visão simples", leitura: "Leitura", "sem-grau": "Sem grau" }[
    it.uso
  ];
  const meta = [
    `Cor: ${it.color}`,
    `${uso}${it.uso === "leitura" && it.leitura ? ` ${it.leitura}` : ""} · ${it.lente === "alto-indice" ? "Alto índice 1.67" : "Policarbonato"}`,
  ];
  if (sun) meta.push("Lentes polarizadas");
  else if (it.filtroAzul) meta.push("Filtro de luz azul");
  const eye = (e: NonNullable<typeof it.od>) =>
    `ESF ${e.sph}${e.cyl && e.cyl !== "0.00" && e.cyl !== "0,00" ? ` · CIL ${e.cyl} · EIXO ${e.axis ?? "-"}` : ""}`;
  if (it.uso === "visao-simples") {
    if (it.od) meta.push(`OD: ${eye(it.od)}`);
    if (it.oe) meta.push(`OE: ${eye(it.oe)}`);
    if (it.dp) meta.push(`DP: ${it.dp} mm`);
  }
  return {
    kind: "oculos",
    id: it.id,
    name: `${sun ? "Óculos de Sol" : "Óculos de Grau"} ${frame.name}`,
    qty: it.qty,
    unitPrice: unit,
    meta,
    details: {
      tipo: it.tipo,
      color: it.color,
      uso: it.uso,
      lente: it.lente,
      filtroAzul: it.filtroAzul,
      leitura: it.leitura ?? null,
      rx: it.rx ?? null,
      od: it.od ?? null,
      oe: it.oe ?? null,
      dp: it.dp ?? null,
    },
  };
}

function priceAccessory(it: Extract<CartItemInput, { kind: "acessorio" }>): PricedLine {
  const a = ACCESSORIES[it.id];
  if (!a) throw new PricingError("Acessório não encontrado.");
  return {
    kind: "acessorio",
    id: it.id,
    name: a.name,
    qty: it.qty,
    unitPrice: a.price,
    meta: [],
    details: {},
  };
}

export function priceItem(it: CartItemInput): PricedLine {
  if (it.kind === "lente") return priceLens(it);
  if (it.kind === "oculos") return priceGlasses(it);
  return priceAccessory(it);
}

/** Acessório oferecido no checkout (mesma regra do checkout.html), ou null se já está no carrinho. */
export function bumpOffer(items: { kind: string; id: string }[]): PricedLine | null {
  const hasLens = items.some((i) => i.kind === "lente");
  const id = hasLens ? BUMP_WITH_LENS : BUMP_WITHOUT_LENS;
  const acc = ACCESSORIES[id];
  if (!acc || items.some((i) => i.id === id)) return null;
  return {
    kind: "acessorio",
    id,
    name: acc.name,
    qty: 1,
    unitPrice: BUMP_PRICES[id] ?? +(acc.price * BUMP_FACTOR).toFixed(2),
    meta: ["Oferta do checkout"],
    details: { bump: true, compareAt: acc.price },
  };
}

export type Quote = {
  lines: PricedLine[];
  bump: PricedLine | null;
  sub: number;
  discount: number;
  coupon: { code: string; pct: number; label: string } | null;
  pix: number;
  frete: { id: FreteId; name: string; eta: string; price: number };
  shipping: number;
  total: number;
  totalCents: number;
};

export function quote(input: {
  items: CartItemInput[];
  bump: boolean;
  coupon?: string | null | undefined;
  frete: FreteId;
}): Quote {
  if (!input.items.length) throw new PricingError("Seu carrinho está vazio.");
  if (input.items.length > 30) throw new PricingError("Carrinho com itens demais.");
  const lines = input.items.map(priceItem);
  const offer = bumpOffer(lines);
  const bump = input.bump && offer ? offer : null;

  // Mesma ordem de operações (e arredondamentos) do checkout.html.
  const itemsSub = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const sub = itemsSub + (bump ? bump.unitPrice : 0);

  let coupon: Quote["coupon"] = null;
  const code = String(input.coupon ?? "")
    .trim()
    .toUpperCase();
  if (code) {
    const cp = COUPONS[code];
    if (!cp) throw new PricingError("Cupom inválido.");
    if (cp.min && itemsSub < cp.min) {
      throw new PricingError(`Cupom ${cp.code} válido para compras acima de R$ ${cp.min},00.`);
    }
    coupon = { code: cp.code, pct: cp.pct, label: cp.label };
  }
  const discount = coupon ? +(sub * coupon.pct).toFixed(2) : 0;
  const after = sub - discount;
  const pix = +(after * PIX_OFF).toFixed(2);
  const frete = FRETES[input.frete];
  if (frete.id === "gratis" && sub < FREE_SHIPPING_MIN) {
    throw new PricingError(`Frete grátis válido para compras acima de R$ ${FREE_SHIPPING_MIN},00.`);
  }
  const shipping = frete.price;
  const total = +(after - pix + shipping).toFixed(2);
  if (!(total > 0)) throw new PricingError("Valor do pedido inválido.");
  return {
    lines,
    bump,
    sub,
    discount,
    coupon,
    pix,
    frete: { ...frete },
    shipping,
    total,
    totalCents: Math.round(total * 100),
  };
}

/** Resumo curto do pedido ("SkyHy 2 meses + Óculos de Grau Lyra") para admin/UTMify. */
export function summarize(q: Pick<Quote, "lines" | "bump">): string {
  const parts = q.lines.map((l) => {
    const plan =
      l.kind === "lente" ? ` ${LENS_PLANS[l.details["planId"] as LensPlanId].label}` : "";
    return `${l.name}${plan}${l.qty > 1 ? ` ×${l.qty}` : ""}`;
  });
  if (q.bump) parts.push(`${q.bump.name} (oferta)`);
  return parts.join(" + ").slice(0, 300);
}

/** Itens do pedido precisam de receita? (mesma regra de HB.cart.hasRx). */
export const needsRx = (lines: PricedLine[]) =>
  lines.some(
    (l) => l.kind === "lente" || (l.kind === "oculos" && l.details["uso"] === "visao-simples"),
  );
