// Pedidos (Pix e cartão) guardados no servidor (tabela orders) para que a aprovação seja reportada
// (UTMify + Meta CAPI + RastroCode) mesmo que o cliente feche a página. Somente servidor.
import { z } from "zod";
import { brand } from "@/lib/brand";
import { isSupabaseConfigured } from "@/lib/db.server";
import type { OrderItem, OrderPayment, OrderRow, OrderTotals } from "@/lib/db-types";
import { HttpError } from "@/lib/http.server";
import { insertFunnelEvent } from "@/lib/funnel.server";
import { sendCapiEvent } from "@/lib/meta.server";
import { encodeGatewayRef, isCardRef, type GatewayId } from "@/lib/gateway-id";
import {
  checkCharge,
  createCharge,
  getActiveGateway,
  isGatewayConfigured,
} from "@/lib/gateway.server";
import {
  CARD_UNAVAILABLE,
  cardAvailability,
  createCardTransaction,
  isHypercashRefused,
} from "@/lib/hypercash.server";
import { isPaidStatus } from "@/lib/pix-status";
import { PIX_UNAVAILABLE } from "@/lib/pixgate.server";
import {
  FRETES,
  MAX_INSTALLMENTS,
  PricingError,
  itemSchema,
  maxInstallments,
  needsRx,
  quote,
  summarize,
  type FreteId,
  type PricedLine,
} from "@/lib/pricing";
import { isRastroFinal, sendRastroOrder, type RastroResult } from "@/lib/rastrocode.server";
import { sendUtmifyOrder, type UtmParams } from "@/lib/utmify.server";

/** O código Pix vale 30 minutos depois de gerado. */
export const PIX_TTL_MS = 30 * 60 * 1000;

async function db() {
  const { supabaseAdmin } = await import("@/lib/db.server");
  return supabaseAdmin;
}

/* ---------------- Validação do checkout ---------------- */

function isValidCpf(raw: string): boolean {
  const c = raw.replace(/\D/g, "");
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < t; i++) sum += Number(c[i]) * (t + 1 - i);
    const d = ((sum * 10) % 11) % 10;
    if (d !== Number(c[t])) return false;
  }
  return true;
}

const UFS =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const digits = (v: string) => v.replace(/\D/g, "");
const str = (max: number) => z.string().trim().max(max);
const utmSchema = z
  .record(z.string().max(40), z.string().max(300).nullable())
  .optional()
  .default({})
  .transform((u) => Object.fromEntries(Object.entries(u).slice(0, 12)) as UtmParams);

export const checkoutSchema = z.object({
  customer: z.object({
    name: str(120).refine((v) => v.split(/\s+/).length >= 2, "Informe nome e sobrenome"),
    email: str(160).toLowerCase().pipe(z.string().email("E-mail inválido")),
    cpf: z.string().max(20).transform(digits).refine(isValidCpf, "CPF inválido"),
    phone: z
      .string()
      .max(20)
      .transform(digits)
      .pipe(z.string().min(10, "Celular inválido").max(13)),
  }),
  address: z.object({
    cep: z.string().max(10).transform(digits).pipe(z.string().length(8, "CEP inválido")),
    rua: str(200).min(1, "Informe o endereço"),
    numero: str(20).min(1, "Informe o número"),
    complemento: str(200).optional().default(""),
    bairro: str(120).min(1, "Informe o bairro"),
    cidade: str(120).min(1, "Informe a cidade"),
    uf: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => UFS.includes(v), "UF inválida"),
  }),
  frete: z.enum(Object.keys(FRETES) as [FreteId, ...FreteId[]]).default("gratis"),
  coupon: z.string().max(40).nullable().optional(),
  bump: z.boolean().default(false),
  items: z.array(itemSchema).min(1, "Seu carrinho está vazio.").max(30),
  rx: z
    .object({
      method: z.enum(["upload", "medico", "depois", "nao-precisa"]),
      fileName: str(200).optional(),
      doctor: z
        .object({
          nome: str(120),
          crm: str(20),
          uf: str(2),
          clinica: str(160).optional(),
          telefone: str(20).optional(),
        })
        .optional(),
    })
    .optional(),
  utm: utmSchema,
  sessionId: z
    .string()
    .regex(/^[\w-]{8,64}$/)
    .optional(),
  fbp: z.string().max(200).nullable().optional(),
  fbc: z.string().max(300).nullable().optional(),
  url: z.string().max(1000).optional(),
  /** Total exibido ao cliente; se divergir do recalculado, o pedido não é criado. */
  expectedTotal: z.number().min(0).max(1_000_000).optional(),
  payment: z
    .discriminatedUnion("method", [
      z.object({ method: z.literal("pix") }),
      z.object({
        method: z.literal("card"),
        // Token gerado pelo SDK da HyperCash no navegador. O número do cartão nunca chega aqui.
        cardHash: z.string().min(10).max(4000),
        installments: z.number().int().min(1).max(MAX_INSTALLMENTS),
      }),
    ])
    .default({ method: "pix" }),
  /** Senha do /admin (mesma aba): libera o cartão para teste mesmo desligado. */
  adminPassword: z.string().max(200).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

function orderNumber(): string {
  const d = new Date();
  const yymm = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const rnd = crypto.getRandomValues(new Uint32Array(1))[0]! % 100000;
  return `${brand.orderPrefix}-${yymm}-${String(rnd).padStart(5, "0")}`;
}

const toItem = (l: PricedLine): OrderItem => ({ ...l, details: l.details as OrderItem["details"] });

export type CreatedOrder = {
  orderId: string;
  number: string;
  method: "pix" | "card";
  /** waiting_payment (Pix gerado / cartão em análise) ou paid (cartão aprovado na hora). */
  status: string;
  paid: boolean;
  qrcode: string | null;
  amount: number;
  amountCents: number;
  expiresAt: string | null;
  totals: OrderTotals;
  items: OrderItem[];
};

/** Como o pedido vai ser cobrado: Pix no gateway ativo ou cartão (token do SDK) na HyperCash. */
export type Charge =
  | { method: "pix"; gateway: GatewayId }
  | { method: "card"; cardHash: string; installments: number };

/** Dados gravados do pedido (checkout ou pós-compra). */
export type NewOrder = {
  customer: OrderRow["customer"];
  address: OrderRow["address"];
  items: OrderItem[];
  totals: OrderTotals;
  summary: string;
  amountCents: number;
  rx: OrderRow["rx"];
  sessionId: string | null;
  utm: UtmParams;
  fbp: string | null;
  fbc: string | null;
  url: string | null;
};

type ReqCtx = { ip: string | null; ua: string | null; origin: string };

/**
 * Confere se a forma de pagamento está disponível antes de gravar o pedido.
 * `adminPassword` (mesma aba do /admin) libera o cartão para teste mesmo desligado.
 */
export async function preparePayment(
  card: { cardHash: string; installments: number } | null,
  adminPassword?: string,
): Promise<Charge> {
  let charge: Charge;
  if (card) {
    if (!(await cardAvailability(adminPassword)).enabled) {
      throw new HttpError(503, CARD_UNAVAILABLE);
    }
    charge = { method: "card", ...card };
  } else {
    const gateway = await getActiveGateway();
    if (!(await isGatewayConfigured(gateway))) {
      console.error("checkout: chave do gateway não configurada", gateway);
      throw new HttpError(503, PIX_UNAVAILABLE);
    }
    charge = { method: "pix", gateway };
  }
  if (!isSupabaseConfigured()) {
    console.error("checkout: Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    throw new HttpError(503, PIX_UNAVAILABLE);
  }
  return charge;
}

/** Grava o pedido antes de cobrar (número único; tenta de novo em colisão). */
export async function insertOrder(
  o: NewOrder,
  ctx: ReqCtx,
  createdAt: number,
): Promise<Pick<OrderRow, "id" | "number">> {
  const supa = await db();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: ins, error } = await supa
      .from("orders")
      .insert({
        number: orderNumber(),
        status: "creating",
        amount_cents: o.amountCents,
        customer: o.customer,
        address: o.address,
        items: o.items,
        totals: o.totals,
        summary: o.summary,
        rx: o.rx,
        session_id: o.sessionId,
        utm: o.utm ?? {},
        fbp: o.fbp,
        fbc: o.fbc,
        ip: ctx.ip,
        ua: ctx.ua,
        url: o.url,
        created_at: new Date(createdAt).toISOString(),
      })
      .select("id,number")
      .single();
    if (!error) return ins as Pick<OrderRow, "id" | "number">;
    if (error.code !== "23505") {
      console.error("createOrder insert error", error.message);
      throw new HttpError(503, PIX_UNAVAILABLE);
    }
  }
  throw new HttpError(503, PIX_UNAVAILABLE);
}

/** Domínio dos postbacks: o domínio em que o cliente está comprando (funciona em qualquer domínio
 * conectado). PUBLIC_SITE_URL só entra quando a origem não é pública (ex.: localhost). */
function postbackBase(origin: string): string {
  const isPublicOrigin = /^https:\/\//.test(origin) && !/localhost|127\.0\.0\.1/.test(origin);
  return (isPublicOrigin ? origin : process.env["PUBLIC_SITE_URL"] || origin).replace(/\/+$/, "");
}

/**
 * Cobra o pedido já gravado — Pix no gateway ativo ou cartão na HyperCash — e avisa a UTMify
 * (pendente). Cartão aprovado na hora já é reportado como venda; recusado vira HttpError 402.
 */
export async function chargeOrder(
  row: Pick<OrderRow, "id" | "number">,
  o: NewOrder,
  charge: Charge,
  createdAt: number,
  ctx: ReqCtx,
): Promise<CreatedOrder> {
  const supa = await db();
  const base = postbackBase(ctx.origin);
  const totals: OrderTotals = { ...o.totals };
  const markFailed = () =>
    supa
      .from("orders")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", row.id);

  let qrcode: string | null = null;
  let expiresAt: string | null = null;
  let paid = false;
  let paidAmount = 0;
  if (charge.method === "card") {
    const a = o.address;
    const address = {
      street: a.rua,
      streetNumber: a.numero,
      complement: a.complemento || "Sem complemento",
      zipCode: a.cep,
      neighborhood: a.bairro,
      city: a.cidade,
      state: a.uf,
      country: "BR" as const,
    };
    const shippingCents = Math.round(totals.shipping * 100);
    let tx;
    try {
      tx = await createCardTransaction({
        amount: o.amountCents,
        cardHash: charge.cardHash,
        installments: charge.installments,
        customer: o.customer,
        address,
        shippingFee: shippingCents,
        // Nome genérico (igual ao Pix) — sem detalhes dos produtos na fatura.
        items: [
          { title: brand.chargeDescription, unitPrice: o.amountCents - shippingCents, quantity: 1 },
        ],
        postbackUrl: `${base}/api/public/hypercash-webhook`,
        ip: ctx.ip,
      });
    } catch (e) {
      await markFailed();
      throw new HttpError(
        502,
        e instanceof Error ? e.message : "Não foi possível processar o cartão.",
      );
    }
    const refused = isHypercashRefused(tx.status);
    paid = isPaidStatus(tx.status);
    paidAmount = tx.amount;
    totals.payment = {
      method: "card",
      installments: charge.installments,
      card: tx.card,
      refusedReason: tx.refusedReason,
    };
    const { error: upErr } = await supa
      .from("orders")
      .update({
        gateway_id: encodeGatewayRef("hypercash", tx.id),
        status: refused ? "refused" : "waiting_payment",
        totals,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (upErr) console.error("createOrder update error", row.id, upErr.message);
    if (refused) {
      throw new HttpError(
        402,
        `Pagamento recusado: ${tx.refusedReason ?? "o banco emissor não informou o motivo"}. Confira os dados do cartão ou pague com Pix.`,
      );
    }
  } else {
    let c;
    try {
      c = await createCharge(charge.gateway, {
        orderId: row.id,
        orderNumber: row.number,
        name: o.customer.name,
        cpf: o.customer.cpf,
        email: o.customer.email,
        phone: o.customer.phone,
        amountCents: o.amountCents,
        siteBase: base,
        expiresInSeconds: PIX_TTL_MS / 1000,
      });
    } catch (e) {
      await markFailed();
      throw new HttpError(502, e instanceof Error ? e.message : "Não foi possível gerar o Pix.");
    }
    qrcode = c.qrcode;
    expiresAt = new Date(createdAt + PIX_TTL_MS).toISOString();
    const { error: upErr } = await supa
      .from("orders")
      .update({
        gateway_id: c.ref,
        qrcode,
        status: "waiting_payment",
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (upErr) console.error("createOrder update error", row.id, upErr.message);
  }

  if (paid) {
    // Cartão aprovado na hora: venda reportada já (UTMify paid + Meta CAPI + RastroCode).
    await reportPaidOnce(row.id, paidAmount);
  } else {
    // Pix gerado / cartão em análise → UTMify como pendente (não é conversão).
    await reportPendingToUtmify({
      id: row.id,
      number: row.number,
      amountCents: o.amountCents,
      customer: o.customer,
      summary: o.summary,
      utm: o.utm,
      ip: ctx.ip,
      createdAt,
    });
  }

  return {
    orderId: row.id,
    number: row.number,
    method: charge.method,
    status: paid ? "paid" : "waiting_payment",
    paid,
    qrcode,
    amount: o.amountCents / 100,
    amountCents: o.amountCents,
    expiresAt,
    totals,
    items: o.items,
  };
}

/** Cria o pedido do checkout: recalcula o valor, grava e cobra (Pix ou cartão). */
export async function createOrder(data: CheckoutInput, ctx: ReqCtx): Promise<CreatedOrder> {
  // Preço sempre definido no servidor — nunca confiar no cliente.
  let q;
  try {
    q = quote({ items: data.items, bump: data.bump, coupon: data.coupon, frete: data.frete });
  } catch (e) {
    if (e instanceof PricingError) throw new HttpError(422, e.message);
    throw e;
  }
  if (data.expectedTotal !== undefined && Math.abs(data.expectedTotal - q.total) > 0.009) {
    throw new HttpError(
      409,
      `O valor do pedido foi atualizado para R$ ${q.total.toFixed(2).replace(".", ",")}. Revise o resumo e tente novamente.`,
    );
  }
  const rxNeeded = needsRx(q.lines);
  // O checkout não pede a receita: pedidos com grau ficam como "enviar depois" (por e-mail).
  const rx = rxNeeded
    ? data.rx && data.rx.method !== "nao-precisa"
      ? data.rx
      : { method: "depois" as const }
    : { method: "nao-precisa" as const };

  // Configuração conferida depois da validação: erros de cupom/itens aparecem mesmo sem gateway.
  const card = data.payment.method === "card" ? data.payment : null;
  if (card) {
    const max = maxInstallments(q.total);
    if (card.installments > max) {
      throw new HttpError(422, `Este pedido pode ser parcelado em até ${max}x sem juros.`);
    }
  }
  const charge = await preparePayment(
    card ? { cardHash: card.cardHash, installments: card.installments } : null,
    data.adminPassword,
  );

  const order: NewOrder = {
    customer: data.customer,
    address: data.address,
    items: [...q.lines, ...(q.bump ? [q.bump] : [])].map(toItem),
    totals: {
      sub: q.sub,
      discount: q.discount,
      coupon: q.coupon,
      pix: q.pix,
      shipping: q.shipping,
      total: q.total,
      frete: q.frete,
      bump: q.bump ? toItem(q.bump) : null,
      payment: card ? { method: "card", installments: card.installments } : { method: "pix" },
    },
    summary: summarize(q),
    amountCents: q.totalCents,
    rx: rx as OrderRow["rx"],
    sessionId: data.sessionId ?? null,
    utm: data.utm ?? {},
    fbp: data.fbp ?? null,
    fbc: data.fbc ?? null,
    url: data.url ?? null,
  };
  const createdAt = Date.now();
  const row = await insertOrder(order, ctx, createdAt);
  const created = await chargeOrder(row, order, charge, createdAt, ctx);

  // Funil (etapa "pix" = pedido finalizado, Pix ou cartão). Não pode quebrar a compra.
  if (data.sessionId) {
    await insertFunnelEvent({
      session_id: data.sessionId,
      event_type: "checkout_step",
      path: "/checkout.html",
      bundle_id: q.lines[0]?.id ?? null,
      bundle_name: order.summary.slice(0, 120),
      value: q.total,
      utm: data.utm,
      metadata: {
        step: "pix",
        orderId: row.id,
        number: row.number,
        name: data.customer.name,
        email: data.customer.email,
        phone: data.customer.phone,
        cidade: data.address.cidade,
        uf: data.address.uf,
        frete: data.frete,
        bump: !!q.bump,
        method: charge.method,
      },
    });
  }
  return created;
}

/* ---------------- Leitura ---------------- */

export async function getOrder(id: string): Promise<OrderRow | null> {
  const { data } = await (await db()).from("orders").select("*").eq("id", id).maybeSingle();
  return (data as OrderRow | null) ?? null;
}

export async function getOrderByGatewayId(gatewayId: string): Promise<OrderRow | null> {
  const { data } = await (
    await db()
  )
    .from("orders")
    .select("*")
    .eq("gateway_id", gatewayId)
    .maybeSingle();
  return (data as OrderRow | null) ?? null;
}

export async function getOrderByNumber(number: string): Promise<OrderRow | null> {
  const { data } = await (await db()).from("orders").select("*").eq("number", number).maybeSingle();
  return (data as OrderRow | null) ?? null;
}

/* ---------------- UTMify / Meta / RastroCode ---------------- */

/**
 * Avisa a UTMify que o Pix foi gerado ("waiting_payment"). NÃO conta como venda:
 * a UTMify só considera venda quando o mesmo orderId chega depois com "paid".
 */
export async function reportPendingToUtmify(o: {
  id: string;
  number: string;
  amountCents: number;
  customer: { name: string; email: string; phone: string; cpf: string };
  summary: string;
  utm?: UtmParams | null;
  ip?: string | null;
  createdAt: number;
}): Promise<void> {
  const r = await sendUtmifyOrder({
    orderId: o.number,
    status: "waiting_payment",
    // A UTMify exige a MESMA data de criação no envio pendente e no pago.
    createdAt: o.createdAt,
    approvedAt: null,
    customer: {
      name: o.customer.name,
      email: o.customer.email,
      phone: o.customer.phone,
      document: o.customer.cpf,
      ip: o.ip ?? null,
    },
    product: { id: "hubble-pedido", name: `${brand.name} - ${o.summary}`.slice(0, 250) },
    amountCents: o.amountCents,
    utm: o.utm ?? {},
  });
  if (!r.ok && r.error !== "Token não configurado")
    console.error("UTMify pending failed", o.id, r.error);
  try {
    await (
      await db()
    )
      .from("orders")
      .update({ report_result: { utmifyPending: { ...r, at: new Date().toISOString() } } })
      .eq("id", o.id)
      .is("paid_reported_at", null);
  } catch (e) {
    console.error("UTMify pending save failed", e);
  }
}

/**
 * Marca o pedido como pago e reporta a venda uma única vez (trava atômica em paid_reported_at).
 * `extra` traz cookies do Meta/URL quando a chamada vem do navegador.
 */
export async function reportPaidOnce(
  orderId: string,
  gatewayAmount: number,
  extra?: {
    fbp?: string | null | undefined;
    fbc?: string | null | undefined;
    url?: string | undefined;
    ip?: string | null | undefined;
    ua?: string | null | undefined;
  },
): Promise<void> {
  try {
    const supa = await db();
    const now = new Date().toISOString();
    // O status "paid" fica gravado mesmo que os envios falhem (só a trava é liberada).
    await supa
      .from("orders")
      .update({ status: "paid", updated_at: now })
      .eq("id", orderId)
      .neq("status", "paid");
    await supa.from("orders").update({ paid_at: now }).eq("id", orderId).is("paid_at", null);
    const { data: rows, error } = await supa
      .from("orders")
      .update({ paid_reported_at: now, updated_at: now })
      .eq("id", orderId)
      .is("paid_reported_at", null)
      .select("*");
    if (error) {
      console.error("reportPaidOnce lock error", error.message);
      return;
    }
    const o = rows?.[0] as OrderRow | undefined;
    if (!o) return; // já reportado ou pedido desconhecido

    const amount =
      Number.isFinite(gatewayAmount) && gatewayAmount > 0 ? gatewayAmount : o.amount_cents;
    const c = o.customer;
    const productName = `${brand.name} - ${o.summary}`.slice(0, 250);
    // Canal que já confirmou numa tentativa anterior não recebe de novo (nunca duplica a venda).
    const done = (o.report_result ?? {}) as {
      utmify?: Awaited<ReturnType<typeof sendUtmifyOrder>>;
      meta?: Awaited<ReturnType<typeof sendCapiEvent>>;
    };
    const utmify = done.utmify?.ok
      ? done.utmify
      : await sendUtmifyOrder({
          orderId: o.number,
          status: "paid",
          createdAt: new Date(o.created_at).getTime(),
          approvedAt: Date.now(),
          customer: { name: c.name, email: c.email, phone: c.phone, document: c.cpf, ip: o.ip },
          product: { id: "hubble-pedido", name: productName },
          amountCents: amount,
          utm: o.utm ?? {},
        });
    const meta = done.meta?.ok
      ? done.meta
      : await sendCapiEvent({
          eventName: "Purchase",
          eventId: `purchase-${o.id}`,
          url: extra?.url ?? o.url ?? undefined,
          user: {
            email: c.email,
            phone: c.phone,
            name: c.name,
            cpf: c.cpf,
            fbp: extra?.fbp ?? o.fbp ?? null,
            fbc: extra?.fbc ?? o.fbc ?? null,
            ip: extra?.ip ?? o.ip ?? null,
            ua: extra?.ua ?? o.ua ?? null,
          },
          customData: {
            value: amount / 100,
            currency: "BRL",
            content_name: o.summary,
            content_ids: o.items.map((i) => i.id),
            content_type: "product",
            num_items: o.items.reduce((s, i) => s + i.qty, 0),
            order_id: o.number,
          },
        });
    // RastroCode: idempotente por transaction_id; respostas definitivas não são reenviadas.
    const prev = (o.report_result as { rastro?: RastroResult } | null)?.rastro;
    const a = o.address;
    // Compras pós-compra vão no mesmo envio do pedido principal: não geram outro rastreio.
    const rastro: RastroResult = isRastroFinal(prev)
      ? prev!
      : o.totals?.upsell
        ? {
            ok: true,
            details: `pós-compra do pedido ${o.totals.upsell.number}: vai no mesmo envio`,
          }
        : await sendRastroOrder({
            transactionId: o.number,
            customer: { name: c.name, email: c.email, phone: c.phone, document: c.cpf },
            address: {
              street: a.rua,
              number: a.numero,
              complement: a.complemento,
              neighborhood: a.bairro,
              city: a.cidade,
              state: a.uf,
              zipcode: a.cep,
            },
            products: o.items.map((i) => ({ name: i.name, quantity: i.qty, price: i.unitPrice })),
          });
    // Sem token configurado não adianta ficar tentando de novo a cada consulta.
    const notConfigured = (r: { ok: boolean; error?: string | undefined }) =>
      !r.ok && /não configurad/i.test(r.error ?? "");
    const allOk = (utmify.ok || notConfigured(utmify)) && (meta.ok || notConfigured(meta));
    console.log("reportPaidOnce", o.id, JSON.stringify({ utmify, meta, rastro }));
    await supa
      .from("orders")
      .update({
        report_result: {
          ...(o.report_result ?? {}),
          utmify,
          meta,
          rastro,
          at: new Date().toISOString(),
        },
        ...(allOk ? {} : { paid_reported_at: null }),
        ...(extra?.fbp ? { fbp: extra.fbp } : {}),
        ...(extra?.fbc ? { fbc: extra.fbc } : {}),
      })
      .eq("id", o.id);
  } catch (e) {
    console.error("reportPaidOnce failed", e);
  }
}

/* ---------------- Status (polling da página do pedido / webhook) ---------------- */

const lastCheck = new Map<string, number>();

/**
 * Confere o pagamento no gateway (no máximo 1x a cada 4 s por pedido neste worker) e,
 * se pago, marca e reporta uma única vez. Devolve o pedido atualizado.
 */
export async function refreshOrder(
  o: OrderRow,
  extra?: Parameters<typeof reportPaidOnce>[2],
): Promise<OrderRow> {
  const pending = o.status === "waiting_payment" || o.status === "expired";
  const retryReport = o.status === "paid" && !o.paid_reported_at;
  if (!o.gateway_id || (!pending && !retryReport)) return o;
  const now = Date.now();
  if ((lastCheck.get(o.id) ?? 0) > now - 4000) return o;
  lastCheck.set(o.id, now);
  if (lastCheck.size > 2000)
    for (const [k, t] of lastCheck) if (t < now - 60_000) lastCheck.delete(k);
  try {
    const { paid, refused, amount } = await checkCharge(o.gateway_id);
    if (paid || retryReport) {
      await reportPaidOnce(o.id, amount, extra);
      return (await getOrder(o.id)) ?? { ...o, status: "paid" };
    }
    if (refused && pending) {
      // Cartão que estava em análise e o banco recusou depois.
      await (
        await db()
      )
        .from("orders")
        .update({ status: "refused", updated_at: new Date().toISOString() })
        .eq("id", o.id)
        .eq("status", o.status);
      return { ...o, status: "refused" };
    }
  } catch (e) {
    console.error("refreshOrder failed", o.id, e);
  }
  return o;
}

/** Status público (sem dados pessoais além do primeiro nome). */
export function publicOrder(o: OrderRow) {
  const paid = o.status === "paid";
  const expired =
    !paid &&
    o.status === "waiting_payment" &&
    !!o.expires_at &&
    new Date(o.expires_at).getTime() < Date.now();
  const status = paid ? "paid" : expired ? "expired" : o.status;
  const pay = o.totals?.payment;
  return {
    ok: true,
    id: o.id,
    number: o.number,
    status,
    paid,
    method: isCardRef(o.gateway_id) || pay?.method === "card" ? "card" : "pix",
    installments: pay?.method === "card" ? pay.installments : null,
    card:
      pay?.method === "card" && pay.card
        ? { brand: pay.card.brand ?? null, last4: pay.card.lastDigits ?? null }
        : null,
    /** Compra pós-compra: pedido principal (id/número) e o que foi comprado nesta cobrança. */
    upsell: o.totals?.upsell ?? null,
    amount: o.amount_cents / 100,
    amountCents: o.amount_cents,
    qrcode: paid || expired ? null : o.qrcode,
    expiresAt: o.expires_at,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    firstName: (o.customer?.name ?? "").split(/\s+/)[0] ?? "",
    rxMethod: (o.rx as { method?: string } | null)?.method ?? null,
    items: (o.items ?? []).map((i) => ({
      kind: i.kind,
      id: i.id,
      name: i.name,
      qty: i.qty,
      price: i.unitPrice,
      meta: i.meta,
    })),
    totals: {
      sub: o.totals?.sub ?? 0,
      discount: o.totals?.discount ?? 0,
      coupon: o.totals?.coupon?.code ?? null,
      shipping: o.totals?.shipping ?? 0,
      total: o.totals?.total ?? o.amount_cents / 100,
      frete: o.totals?.frete ?? null,
    },
  };
}
