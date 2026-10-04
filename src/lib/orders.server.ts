// Pedidos Pix guardados no servidor (tabela orders) para que a aprovação seja reportada
// (UTMify + Meta CAPI + RastroCode) mesmo que o cliente feche a página. Somente servidor.
import { z } from "zod";
import { brand } from "@/lib/brand";
import { isSupabaseConfigured } from "@/lib/db.server";
import type { OrderItem, OrderRow, OrderTotals } from "@/lib/db-types";
import { HttpError } from "@/lib/http.server";
import { insertFunnelEvent } from "@/lib/funnel.server";
import { sendCapiEvent } from "@/lib/meta.server";
import { isPaidStatus } from "@/lib/pix-status";
import {
  PIX_UNAVAILABLE,
  fetchGatewayStatus,
  gatewayCashin,
  isPixGateConfigured,
} from "@/lib/pixgate.server";
import {
  FRETES,
  PricingError,
  itemSchema,
  needsRx,
  quote,
  summarize,
  type FreteId,
  type PricedLine,
} from "@/lib/pricing";
import { isRastroFinal, sendRastroOrder, type RastroResult } from "@/lib/rastrocode.server";
import { sendUtmifyOrder, type UtmParams } from "@/lib/utmify.server";

export { isPaidStatus };

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
  qrcode: string;
  amount: number;
  amountCents: number;
  expiresAt: string;
  totals: OrderTotals;
  items: OrderItem[];
};

/** Cria o pedido: recalcula o valor, grava, gera o Pix na PixGate e avisa UTMify (pendente). */
export async function createOrder(
  data: CheckoutInput,
  ctx: { ip: string | null; ua: string | null; origin: string },
): Promise<CreatedOrder> {
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
  const rx = rxNeeded ? data.rx : { method: "nao-precisa" as const };
  if (rxNeeded) {
    if (!rx || rx.method === "nao-precisa")
      throw new HttpError(422, "Informe como vamos receber sua receita.");
    if (rx.method === "medico" && (!rx.doctor?.nome || digits(rx.doctor.crm).length < 4)) {
      throw new HttpError(422, "Informe nome e CRM do seu oftalmologista.");
    }
  }

  // Configuração conferida depois da validação: erros de cupom/itens aparecem mesmo sem gateway.
  if (!isPixGateConfigured()) {
    console.error("checkout: PIXGATE_API_KEY não configurada");
    throw new HttpError(503, PIX_UNAVAILABLE);
  }
  if (!isSupabaseConfigured()) {
    console.error("checkout: Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    throw new HttpError(503, PIX_UNAVAILABLE);
  }

  const totals: OrderTotals = {
    sub: q.sub,
    discount: q.discount,
    coupon: q.coupon,
    pix: q.pix,
    shipping: q.shipping,
    total: q.total,
    frete: q.frete,
    bump: q.bump ? toItem(q.bump) : null,
  };
  const items = [...q.lines, ...(q.bump ? [q.bump] : [])].map(toItem);
  const summary = summarize(q);
  const createdAt = Date.now();
  const supa = await db();

  // 1) Grava o pedido antes de cobrar (número único; tenta de novo em colisão).
  let row: Pick<OrderRow, "id" | "number"> | null = null;
  for (let attempt = 0; attempt < 4 && !row; attempt++) {
    const { data: ins, error } = await supa
      .from("orders")
      .insert({
        number: orderNumber(),
        status: "creating",
        amount_cents: q.totalCents,
        customer: data.customer,
        address: data.address,
        items,
        totals,
        summary,
        rx: rx ?? null,
        session_id: data.sessionId ?? null,
        utm: data.utm ?? {},
        fbp: data.fbp ?? null,
        fbc: data.fbc ?? null,
        ip: ctx.ip,
        ua: ctx.ua,
        url: data.url ?? null,
        created_at: new Date(createdAt).toISOString(),
      })
      .select("id,number")
      .single();
    if (!error) row = ins as Pick<OrderRow, "id" | "number">;
    else if (error.code !== "23505") {
      console.error("createOrder insert error", error.message);
      throw new HttpError(503, PIX_UNAVAILABLE);
    }
  }
  if (!row) throw new HttpError(503, PIX_UNAVAILABLE);

  // 2) Cobrança Pix.
  // Usa o domínio em que o cliente está comprando (funciona em qualquer domínio conectado).
  // PUBLIC_SITE_URL só entra quando a origem não é pública (ex.: localhost).
  const isPublicOrigin = /^https:\/\//.test(ctx.origin) && !/localhost|127\.0\.0\.1/.test(ctx.origin);
  const postbackBase = (isPublicOrigin ? ctx.origin : process.env["PUBLIC_SITE_URL"] || ctx.origin).replace(/\/+$/, "");
  let charge;
  try {
    charge = await gatewayCashin({
      name: data.customer.name,
      cpf: data.customer.cpf,
      amountCents: q.totalCents,
      postbackUrl: `${postbackBase}/api/public/pix-webhook`,
    });
  } catch (e) {
    await supa
      .from("orders")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", row.id);
    throw new HttpError(502, e instanceof Error ? e.message : "Não foi possível gerar o Pix.");
  }
  const expiresAt = new Date(createdAt + PIX_TTL_MS).toISOString();
  const { error: upErr } = await supa
    .from("orders")
    .update({
      gateway_id: charge.id,
      qrcode: charge.qrcode,
      status: "waiting_payment",
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (upErr) console.error("createOrder update error", row.id, upErr.message);

  // 3) Funil (etapa "pix") + UTMify pendente. Nenhum dos dois pode quebrar a compra.
  if (data.sessionId) {
    await insertFunnelEvent({
      session_id: data.sessionId,
      event_type: "checkout_step",
      path: "/checkout.html",
      bundle_id: q.lines[0]?.id ?? null,
      bundle_name: summary.slice(0, 120),
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
      },
    });
  }
  await reportPendingToUtmify({
    id: row.id,
    number: row.number,
    amountCents: q.totalCents,
    customer: data.customer,
    summary,
    utm: data.utm,
    ip: ctx.ip,
    createdAt,
  });

  return {
    orderId: row.id,
    number: row.number,
    qrcode: charge.qrcode,
    amount: q.total,
    amountCents: q.totalCents,
    expiresAt,
    totals,
    items,
  };
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
    const utmify = await sendUtmifyOrder({
      orderId: o.number,
      status: "paid",
      createdAt: new Date(o.created_at).getTime(),
      approvedAt: Date.now(),
      customer: { name: c.name, email: c.email, phone: c.phone, document: c.cpf, ip: o.ip },
      product: { id: "hubble-pedido", name: productName },
      amountCents: amount,
      utm: o.utm ?? {},
    });
    const meta = await sendCapiEvent({
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
    const rastro: RastroResult = isRastroFinal(prev)
      ? prev!
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
    const { status, amount } = await fetchGatewayStatus(o.gateway_id);
    if (isPaidStatus(status) || retryReport) {
      await reportPaidOnce(o.id, amount, extra);
      return (await getOrder(o.id)) ?? { ...o, status: "paid" };
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
  return {
    ok: true,
    id: o.id,
    number: o.number,
    status,
    paid,
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
