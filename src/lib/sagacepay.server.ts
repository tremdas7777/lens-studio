// Gateway Pix (SagacePay). Somente servidor. Docs: https://sub.sagacepay.com/docs
// Chave (sk_live_...) salva no /admin (private_settings) ou, como reserva, em SAGACEPAY_API_KEY.
import { brand } from "@/lib/brand";
import { getPrivateSettings } from "@/lib/private-settings.server";
import { PIX_UNAVAILABLE } from "@/lib/pixgate.server";

const API = "https://sagacepay.com/api";
export const SAGACEPAY_KEY = "sagacepay_api_key";

export async function getSagacePayKey(): Promise<{
  key: string | null;
  source: "db" | "env" | null;
}> {
  const fromDb = (await getPrivateSettings([SAGACEPAY_KEY])).get(SAGACEPAY_KEY);
  if (fromDb) return { key: fromDb, source: "db" };
  const fromEnv = process.env["SAGACEPAY_API_KEY"];
  return fromEnv ? { key: fromEnv, source: "env" } : { key: null, source: null };
}

async function headers(key?: string): Promise<Record<string, string>> {
  const k = key ?? (await getSagacePayKey()).key;
  if (!k) throw new Error(PIX_UNAVAILABLE);
  return { "x-api-key": k, "Content-Type": "application/json", Accept: "application/json" };
}

/**
 * Única regra de "pago" da SagacePay. Status da venda: pending → paid | failed | refunded | expired.
 * Só "paid" conta (refunded = estornado, não é venda).
 */
export const isSagacePayPaid = (status: string | null | undefined) =>
  String(status ?? "")
    .trim()
    .toLowerCase() === "paid";

/** Gera a cobrança Pix (POST /sales). Valor em centavos; a SagacePay recebe reais (decimal). */
export async function sagaceCashin(o: {
  name: string;
  cpf: string;
  email?: string;
  phone?: string;
  amountCents: number;
  postbackUrl: string;
  /** Número do pedido na loja — volta nos webhooks. */
  externalId: string;
  /** Mesma chave = mesma cobrança (evita Pix duplicado em retentativa). */
  idempotencyKey: string;
  expiresInSeconds: number;
}): Promise<{ id: string; qrcode: string; status: string }> {
  const amount = Number((o.amountCents / 100).toFixed(2));
  const res = await fetch(`${API}/sales`, {
    method: "POST",
    headers: { ...(await headers()), "idempotency-key": o.idempotencyKey },
    body: JSON.stringify({
      amount,
      // Descrição genérica — sem detalhes dos produtos.
      description: brand.chargeDescription,
      expirationInSeconds: Math.min(86400, Math.max(300, Math.round(o.expiresInSeconds))),
      customer: {
        name: o.name,
        document: o.cpf,
        ...(o.email ? { email: o.email } : {}),
        ...(o.phone ? { phone: o.phone } : {}),
      },
      items: [{ description: brand.chargeDescription, quantity: 1, unitPrice: amount }],
      postbackUrl: o.postbackUrl,
      externalId: o.externalId,
      // Sem "tracking": Meta CAPI e UTMify já são enviados pela própria loja (evita duplicar).
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json().catch(() => null)) as any;
  const sale = json?.data && !json?.id ? json.data : json;
  const txId = sale?.id;
  const qrcode = sale?.pixCode;
  if (!res.ok || !txId || !qrcode) {
    console.error("SagacePay error", res.status, JSON.stringify(json)?.slice(0, 500));
    throw new Error("Não foi possível gerar o Pix. Confira seus dados e tente novamente.");
  }
  return {
    id: String(txId),
    qrcode: String(qrcode),
    status: String(sale?.status ?? "pending").toLowerCase(),
  };
}

/** Consulta o status real da venda (GET /sales/:id). Valor devolvido em centavos. */
export async function sagaceStatus(id: string): Promise<{ status: string; amount: number }> {
  const res = await fetch(`${API}/sales/${encodeURIComponent(id)}`, { headers: await headers() });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json().catch(() => null)) as any;
  const sale = json?.data && !json?.id ? json.data : json;
  // Só status e nomes dos campos no log (sem dados pessoais).
  console.log("sagacepay-status", id, res.status, JSON.stringify(sale?.status));
  if (!res.ok) throw new Error(`SagacePay HTTP ${res.status}`);
  return {
    status: String(sale?.status ?? "pending").toLowerCase(),
    amount: Math.round(Number(sale?.amount ?? 0) * 100),
  };
}

/** Testa a chave sem criar cobrança (GET /sales?limit=1). */
export async function sagaceTestKey(
  key?: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(`${API}/sales?page=1&limit=1`, { headers: await headers(key) });
    if (res.ok) return { ok: true, status: res.status };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json().catch(() => null)) as any;
    return { ok: false, status: res.status, error: String(json?.message ?? "").slice(0, 200) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha de conexão" };
  }
}
