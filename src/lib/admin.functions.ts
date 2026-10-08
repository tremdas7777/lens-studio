import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type { FunnelEventRow, OrderRow } from "@/lib/db-types";
import { assertAdmin, checkAdminPassword } from "@/lib/admin-auth.server";
import { originOf, type OriginInput } from "@/lib/traffic-origin";

async function db() {
  const { supabaseAdmin } = await import("@/lib/db.server");
  return supabaseAdmin;
}

const pw = z.object({ password: z.string().min(1).max(200) });

export const verifyAdminPassword = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.parse(d))
  .handler(async ({ data }) => {
    if (!process.env["HUBBLE_ADMIN_PASSWORD"])
      return { ok: false, error: "HUBBLE_ADMIN_PASSWORD não configurada" };
    return { ok: checkAdminPassword(data.password) };
  });

export type TrafficSourceRow = {
  source: string;
  medium: string | null;
  campaign: string | null;
  visitors: number;
  viewedProduct: number;
  checkout: number;
  /** Pedido gerado (Pix ou cartão). */
  orders: number;
};

/**
 * Sessões por origem (UTM, ou o site de onde veio, ou "Direto") e campanha. A origem da sessão é a
 * do primeiro evento com UTM; sem UTM, a do primeiro evento. Eventos em ordem de criação. Função pura.
 */
export function trafficSources(
  events: (OriginInput & { session_id: string; event_type: string })[],
  ownHost: string | null,
): TrafficSourceRow[] {
  type S = { origin: ReturnType<typeof originOf>; types: Set<string> };
  const bySession = new Map<string, S>();
  for (const e of events) {
    let s = bySession.get(e.session_id);
    const o = originOf(e, ownHost);
    if (!s) bySession.set(e.session_id, (s = { origin: o, types: new Set() }));
    else if (!s.origin.tagged && o.tagged) s.origin = o;
    s.types.add(e.event_type);
    const step = (e.metadata as { step?: string } | null)?.step;
    if (e.event_type === "checkout_step" && step === "pix") s.types.add("order");
  }
  const rows = new Map<string, TrafficSourceRow>();
  for (const { origin, types } of bySession.values()) {
    const key = `${origin.source}\u0000${origin.campaign ?? ""}`;
    let r = rows.get(key);
    if (!r) {
      r = {
        source: origin.source,
        medium: origin.medium,
        campaign: origin.campaign,
        visitors: 0,
        viewedProduct: 0,
        checkout: 0,
        orders: 0,
      };
      rows.set(key, r);
    }
    r.medium ??= origin.medium;
    if (types.has("page_view") || types.has("product_view")) r.visitors++;
    if (types.has("product_view")) r.viewedProduct++;
    if (types.has("checkout_click") || types.has("checkout_step")) r.checkout++;
    if (types.has("order")) r.orders++;
  }
  return [...rows.values()]
    .filter((r) => r.visitors || r.checkout)
    .sort((a, b) => b.visitors - a.visitors || b.checkout - a.checkout)
    .slice(0, 30);
}

export const getAdminFunnel = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    pw
      .extend({
        windowMinutes: z
          .number()
          .int()
          .min(5)
          .max(60 * 24 * 30)
          .default(60 * 24),
        onlineMinutes: z.number().int().min(1).max(60).default(3),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const since = new Date(Date.now() - data.windowMinutes * 60 * 1000).toISOString();
    const onlineSince = new Date(Date.now() - data.onlineMinutes * 60 * 1000).toISOString();
    const supa = await db();
    const [{ data: recent }, { data: all }] = await Promise.all([
      supa
        .from("funnel_events")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200),
      supa
        .from("funnel_events")
        .select(
          "session_id,event_type,created_at,referrer,utm_source,utm_medium,utm_campaign,metadata",
        )
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(50000),
    ]);

    const events = (all ?? []) as Pick<
      FunnelEventRow,
      | "session_id"
      | "event_type"
      | "created_at"
      | "referrer"
      | "utm_source"
      | "utm_medium"
      | "utm_campaign"
      | "metadata"
    >[];
    const sessions = new Map<string, Set<string>>();
    const lastSeenBySession = new Map<string, string>();
    for (const e of events) {
      if (!sessions.has(e.session_id)) sessions.set(e.session_id, new Set());
      sessions.get(e.session_id)!.add(e.event_type);
      const prev = lastSeenBySession.get(e.session_id);
      if (!prev || e.created_at > prev) lastSeenBySession.set(e.session_id, e.created_at);
    }

    let visited = 0,
      viewedProduct = 0,
      checkout = 0;
    for (const types of sessions.values()) {
      if (types.has("page_view") || types.has("product_view")) visited++;
      if (types.has("product_view")) viewedProduct++;
      if (types.has("checkout_click") || types.has("checkout_step")) checkout++;
    }
    let onlineNow = 0;
    for (const lastSeen of lastSeenBySession.values()) if (lastSeen >= onlineSince) onlineNow++;

    return {
      recent: (recent ?? []) as FunnelEventRow[],
      sources: trafficSources(events, getRequest()?.headers.get("host") ?? null),
      funnel: {
        visited,
        viewedProduct,
        checkout,
        totalEvents: events.length,
        totalSessions: sessions.size,
        onlineNow,
        windowMinutes: data.windowMinutes,
        onlineMinutes: data.onlineMinutes,
      },
    };
  });

export type AdminOrder = OrderRow;

export const getAdminOrders = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    pw.extend({ days: z.number().int().min(1).max(365).default(30) }).parse(d),
  )
  .handler(async ({ data }): Promise<{ orders: AdminOrder[] }> => {
    assertAdmin(data.password);
    const since = new Date(Date.now() - data.days * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await (
      await db()
    )
      .from("orders")
      .select("*")
      .neq("status", "creating")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return { orders: (rows ?? []) as AdminOrder[] };
  });

/** Reconsulta o gateway e reenvia os relatórios de um pedido (botão no detalhe do pedido). */
export const recheckAdminOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const { getOrder, refreshOrder } = await import("@/lib/orders.server");
    const o = await getOrder(data.id);
    if (!o) throw new Error("Pedido não encontrado");
    const fresh = await refreshOrder(o);
    return { status: fresh.status };
  });

export type AbandonStep = "checkout" | "dados" | "entrega" | "pix";

export type AbandonedCheckout = {
  sessionId: string;
  step: AbandonStep;
  /** Pix gerado há menos de 35 min — ainda pode ser pago. */
  pixPending: boolean;
  firstAt: string;
  lastAt: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  plano: string | null;
  value: number | null;
  cidade: string | null;
  uf: string | null;
  bump: boolean;
  orderId: string | null;
  number: string | null;
  utmSource: string | null;
};

const STEP_ORDER: AbandonStep[] = ["checkout", "dados", "entrega", "pix"];

/** Agrupa os eventos "checkout_step" por sessão (etapa mais avançada + contato mais recente). Função pura. */
export function groupCheckoutEvents(
  events: {
    session_id: string;
    created_at: string;
    bundle_name: string | null;
    value: number | string | null;
    utm_source: string | null;
    metadata: unknown;
  }[],
): Map<string, AbandonedCheckout> {
  const bySession = new Map<string, AbandonedCheckout>();
  for (const e of events ?? []) {
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    const step = String(m["step"] ?? "") as AbandonStep;
    if (!STEP_ORDER.includes(step)) continue;
    const cur =
      bySession.get(e.session_id) ??
      ({
        sessionId: e.session_id,
        step,
        pixPending: false,
        firstAt: e.created_at,
        lastAt: e.created_at,
        name: null,
        email: null,
        phone: null,
        plano: null,
        value: null,
        cidade: null,
        uf: null,
        bump: false,
        orderId: null,
        number: null,
        utmSource: null,
      } satisfies AbandonedCheckout);
    if (STEP_ORDER.indexOf(step) >= STEP_ORDER.indexOf(cur.step)) cur.step = step;
    cur.lastAt = e.created_at;
    const str = (k: string) =>
      typeof m[k] === "string" && (m[k] as string).trim() ? (m[k] as string).trim() : null;
    cur.name = str("name") ?? cur.name;
    cur.email = str("email")?.toLowerCase() ?? cur.email;
    cur.phone = str("phone") ?? cur.phone;
    cur.cidade = str("cidade") ?? cur.cidade;
    cur.uf = str("uf") ?? cur.uf;
    cur.orderId = str("orderId") ?? cur.orderId;
    cur.number = str("number") ?? cur.number;
    if (typeof m["bump"] === "boolean") cur.bump = m["bump"] as boolean;
    cur.plano = e.bundle_name ?? cur.plano;
    cur.value = e.value != null ? Number(e.value) : cur.value;
    cur.utmSource = e.utm_source ?? cur.utmSource;
    bySession.set(e.session_id, cur);
  }
  return bySession;
}

/** Checkouts iniciados e não pagos, com a etapa em que a pessoa parou. */
export const getAbandonedCheckouts = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    pw.extend({ days: z.number().int().min(1).max(90).default(7) }).parse(d),
  )
  .handler(
    async ({
      data,
    }): Promise<{ funnel: Record<AbandonStep | "pago", number>; rows: AbandonedCheckout[] }> => {
      assertAdmin(data.password);
      const since = new Date(Date.now() - data.days * 24 * 60 * 60 * 1000).toISOString();
      const supa = await db();
      const { data: events, error } = await supa
        .from("funnel_events")
        .select("session_id,created_at,bundle_name,value,utm_source,metadata")
        .eq("event_type", "checkout_step")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(10000);
      if (error) throw new Error(error.message);

      const sessions = [...groupCheckoutEvents(events ?? []).values()];

      const orderIds = sessions.map((s) => s.orderId).filter((v): v is string => !!v);
      const paidOrders = new Set<string>();
      for (let i = 0; i < orderIds.length; i += 200) {
        const { data: orders } = await supa
          .from("orders")
          .select("id,status")
          .in("id", orderIds.slice(i, i + 200));
        for (const o of (orders ?? []) as { id: string; status: string }[])
          if (o.status === "paid") paidOrders.add(o.id);
      }
      // Quem pagou em outra sessão (mesmo e-mail) também não conta como abandono.
      const { data: paid } = await supa
        .from("orders")
        .select("customer")
        .eq("status", "paid")
        .gte("created_at", since)
        .limit(5000);
      const paidEmails = new Set<string>(
        ((paid ?? []) as { customer?: { email?: string } }[])
          .map((o) => String(o.customer?.email ?? "").toLowerCase())
          .filter(Boolean),
      );

      const funnel = { checkout: 0, dados: 0, entrega: 0, pix: 0, pago: 0 };
      const rows: AbandonedCheckout[] = [];
      const now = Date.now();
      for (const s of sessions) {
        const idx = STEP_ORDER.indexOf(s.step);
        funnel.checkout++;
        if (idx >= 1) funnel.dados++;
        if (idx >= 2) funnel.entrega++;
        if (idx >= 3) funnel.pix++;
        const isPaid =
          (s.orderId && paidOrders.has(s.orderId)) || (s.email && paidEmails.has(s.email));
        if (isPaid) {
          funnel.pago++;
          continue;
        }
        s.pixPending = s.step === "pix" && now - new Date(s.lastAt).getTime() < 35 * 60 * 1000;
        rows.push(s);
      }
      rows.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
      return { funnel, rows: rows.slice(0, 1000) };
    },
  );

/** Diagnóstico das integrações (só presença das variáveis, nunca valores). */
export const getAdminHealth = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const has = (k: string) => Boolean(process.env[k]);
    const { getActiveGateway, isGatewayConfigured } = await import("@/lib/gateway.server");
    const { GATEWAYS } = await import("@/lib/gateway-id");
    const active = await getActiveGateway();
    return {
      supabase: has("SUPABASE_URL") && has("SUPABASE_SERVICE_ROLE_KEY"),
      gateway: { label: GATEWAYS[active], configured: await isGatewayConfigured(active) },
      rastrocode: has("RASTROCODE_API_KEY"),
      publicSiteUrl: process.env["PUBLIC_SITE_URL"] ?? null,
    };
  });
