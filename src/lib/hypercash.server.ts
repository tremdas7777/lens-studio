// HyperCash (FastSoft white label): pagamentos com cartão. Somente servidor.
// O cartão é tokenizado no navegador pelo SDK deles — aqui só chega o token (hash), nunca o número.
// Chaves salvas no /admin (private_settings) ou, como reserva, em HYPERCASH_SECRET_KEY / HYPERCASH_PUBLIC_KEY.
import { checkAdminPassword } from "@/lib/admin-auth.server";
import { getPrivateSettings, setPrivateSettings } from "@/lib/private-settings.server";

const API = "https://api.hypercashbrasil.com.br/api/user/transactions";

export const HYPERCASH_SECRET = "hypercash_secret_key";
export const HYPERCASH_PUBLIC = "hypercash_public_key";
/** Liga/desliga do cartão no checkout ("1" = ativo). DESLIGADO até ativar no /admin. */
export const CARD_ENABLED_KEY = "card_enabled";

export const CARD_UNAVAILABLE = "Pagamento com cartão indisponível no momento. Pague com Pix.";

type KeyInfo = { key: string | null; source: "db" | "env" | null };

export async function getHypercashKeys(): Promise<{ secret: KeyInfo; public: KeyInfo }> {
  const m = await getPrivateSettings([HYPERCASH_SECRET, HYPERCASH_PUBLIC]);
  const pick = (dbKey: string, env: string): KeyInfo => {
    const fromDb = m.get(dbKey);
    if (fromDb) return { key: fromDb, source: "db" };
    const fromEnv = process.env[env];
    return fromEnv ? { key: fromEnv, source: "env" } : { key: null, source: null };
  };
  return {
    secret: pick(HYPERCASH_SECRET, "HYPERCASH_SECRET_KEY"),
    public: pick(HYPERCASH_PUBLIC, "HYPERCASH_PUBLIC_KEY"),
  };
}

export async function isCardEnabled(): Promise<boolean> {
  return (await getPrivateSettings([CARD_ENABLED_KEY])).get(CARD_ENABLED_KEY) === "1";
}

export async function setCardEnabled(enabled: boolean): Promise<void> {
  await setPrivateSettings([{ key: CARD_ENABLED_KEY, value: enabled ? "1" : "0" }]);
}

/**
 * Cartão disponível para este checkout: ativo no /admin (ou quem está logado no admin, para testar
 * com o cartão desligado) e com as duas chaves. Devolve a chave PÚBLICA (pode ir para o navegador).
 */
export async function cardAvailability(
  adminPassword?: string | null,
): Promise<{ enabled: boolean; publicKey: string | null; live: boolean }> {
  const live = await isCardEnabled().catch(() => false);
  if (!live && !(adminPassword && checkAdminPassword(adminPassword))) {
    return { enabled: false, publicKey: null, live };
  }
  const k = await getHypercashKeys();
  const ok = Boolean(k.secret.key && k.public.key);
  return { enabled: ok, publicKey: ok ? k.public.key : null, live };
}

async function auth(): Promise<string> {
  const { key } = (await getHypercashKeys()).secret;
  if (!key) throw new Error(CARD_UNAVAILABLE);
  return `Basic ${btoa(`x:${key}`)}`;
}

/**
 * Testa a chave secreta sem criar cobrança: consulta uma transação inexistente.
 * 404 = chave aceita; 401/403 = chave inválida.
 */
export async function testHypercashSecret(): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
}> {
  try {
    const res = await fetch(`${API}/00000000-0000-0000-0000-000000000000`, {
      headers: { Authorization: await auth(), Accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403)
      return { ok: false, status: res.status, error: "Chave secreta recusada pela HyperCash" };
    return { ok: res.status < 500, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha de conexão" };
  }
}

export type HcAddress = {
  street: string;
  streetNumber: string;
  complement: string;
  zipCode: string;
  neighborhood: string;
  city: string;
  state: string;
  country: "BR";
};

export type HcTransaction = {
  id: string;
  status: string;
  /** Centavos. */
  amount: number;
  refusedReason: string | null;
  card: { brand?: string; lastDigits?: string } | null;
};

/** Status finais sem pagamento: o banco recusou ou a transação foi cancelada. */
const REFUSED = new Set(["refused", "canceled", "cancelled", "failed"]);
export const isHypercashRefused = (status: string | null | undefined) =>
  REFUSED.has(
    String(status ?? "")
      .trim()
      .toLowerCase(),
  );

/** Texto legível de uma mensagem/motivo do gateway (pode vir como texto, lista ou objeto). */
export function gatewayText(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) return v.map(gatewayText).filter(Boolean).join("; ") || null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (
      gatewayText(o["description"] ?? o["message"] ?? o["reason"] ?? o["error"]) ??
      JSON.stringify(v).slice(0, 200)
    );
  }
  return String(v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTx(json: any): HcTransaction | null {
  const d = json?.data ?? json;
  if (!d?.id) return null;
  return {
    id: String(d.id),
    status: String(d.status ?? "processing").toLowerCase(),
    amount: Number(d.amount ?? 0),
    refusedReason: gatewayText(d.refusedReason),
    card: d.card ? { brand: d.card.brand, lastDigits: d.card.lastDigits } : null,
  };
}

/** Cobra no cartão. Valores em centavos; `items` + `shippingFee` devem somar `amount`. */
export async function createCardTransaction(o: {
  amount: number;
  cardHash: string;
  installments: number;
  customer: { name: string; email: string; phone: string; cpf: string };
  address: HcAddress;
  shippingFee: number;
  items: { title: string; unitPrice: number; quantity: number }[];
  postbackUrl: string;
  ip?: string | null;
}): Promise<HcTransaction> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: await auth(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      amount: o.amount,
      currency: "BRL",
      paymentMethod: "CREDIT_CARD",
      card: { hash: o.cardHash },
      installments: o.installments,
      customer: {
        name: o.customer.name,
        email: o.customer.email,
        phone: o.customer.phone,
        document: { number: o.customer.cpf, type: "CPF" },
        address: o.address,
      },
      shipping: { fee: o.shippingFee, address: o.address },
      items: o.items.map((i) => ({ ...i, tangible: true })),
      postbackUrl: o.postbackUrl,
      ...(o.ip ? { ip: o.ip } : {}),
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json().catch(() => null)) as any;
  const tx = parseTx(json);
  if (!res.ok || !tx) {
    const reason = gatewayText(json?.message ?? json?.error ?? json?.errors);
    // Resposta do gateway (não contém dados do cartão) para enviar ao suporte da HyperCash.
    console.error("HyperCash error", res.status, JSON.stringify(json)?.slice(0, 1500));
    throw new Error(
      `Não foi possível processar o cartão: ${reason ?? `erro ${res.status} no gateway`}.`,
    );
  }
  console.log("hypercash-create", tx.id, tx.status, tx.refusedReason ?? "");
  return tx;
}

export async function getCardTransaction(id: string): Promise<HcTransaction | null> {
  const res = await fetch(`${API}/${encodeURIComponent(id)}`, {
    headers: { Authorization: await auth(), Accept: "application/json" },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json().catch(() => null)) as any;
  const tx = parseTx(json);
  console.log("hypercash-status", id, res.status, tx?.status);
  if (!res.ok && !tx) throw new Error(`HyperCash HTTP ${res.status}`);
  return tx;
}
