// Envio de pedidos pagos para a RastroCode (gera o código de rastreio). Somente servidor.
// A chave fica no segredo RASTROCODE_API_KEY e nunca vai para o navegador.

const API = "https://app.rastrocode.site/api/v1";

export type RastroAddress = {
  street: string;
  number: string;
  complement?: string | undefined;
  neighborhood: string;
  city: string;
  state: string;
  zipcode: string;
};

export type RastroOrder = {
  transactionId: string;
  customer: { name: string; email: string; phone: string; document: string };
  address: RastroAddress;
  products: { name: string; quantity: number; price: number }[];
};

export type RastroResult = {
  ok: boolean;
  status?: number;
  trackingCode?: string | undefined;
  duplicate?: boolean;
  error?: string;
  details?: unknown;
  skipped?: string;
};

const digits = (v: string) => (v ?? "").replace(/\D/g, "");
const cut = (v: string | undefined, max: number) => (v ?? "").trim().slice(0, max);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Monta o corpo exatamente no formato da API. */
function buildBody(o: RastroOrder) {
  const email = o.customer.email.trim().toLowerCase();
  const phone = digits(o.customer.phone);
  const document = digits(o.customer.document);
  const products = o.products.map((p) => ({
    name: cut(p.name, 255),
    quantity: Math.max(1, Math.min(9999, Math.round(p.quantity))),
    price: Number(p.price.toFixed(2)),
  }));
  const total = Number(products.reduce((s, p) => s + p.price * p.quantity, 0).toFixed(2));
  return {
    transaction_id: o.transactionId.replace(/[^\w.-]/g, "-").slice(0, 50),
    customer: {
      name: cut(o.customer.name, 255),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
      phone: phone.length >= 8 && phone.length <= 13 ? phone : "",
      document: document.length === 11 || document.length === 14 ? document : "",
    },
    address: {
      street: cut(o.address.street, 255),
      number: cut(o.address.number, 20),
      ...(o.address.complement?.trim() ? { complement: cut(o.address.complement, 255) } : {}),
      neighborhood: cut(o.address.neighborhood, 255),
      city: cut(o.address.city, 255),
      state: o.address.state.trim().toUpperCase().slice(0, 2),
      zipcode: digits(o.address.zipcode),
    },
    products,
    total,
  };
}

/**
 * Envia o pedido pago. Não retenta erros definitivos (401/402/403/413/415/422);
 * retenta uma vez em 429 (respeitando Retry-After, limitado) e em 5xx.
 */
export async function sendRastroOrder(o: RastroOrder): Promise<RastroResult> {
  const key = process.env["RASTROCODE_API_KEY"];
  if (!key) return { ok: false, error: "RASTROCODE_API_KEY não configurada" };
  const body = JSON.stringify(buildBody(o));

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}/orders`, {
        method: "POST",
        headers: {
          "X-API-Key": key,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
      });
    } catch (e) {
      console.error("RastroCode network error", e);
      if (attempt === 0) {
        await sleep(3000);
        continue;
      }
      return { ok: false, error: "Falha de conexão" };
    }
    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      data?: { tracking_code?: string };
      error?: { code?: string; message?: string; details?: unknown };
    } | null;

    if (res.status === 201 || res.status === 200) {
      return {
        ok: true,
        status: res.status,
        trackingCode: json?.data?.tracking_code,
        duplicate: res.status === 200,
      };
    }

    const err: RastroResult = {
      ok: false,
      status: res.status,
      error: json?.error?.code ?? `HTTP ${res.status}`,
      details: json?.error?.details,
    };
    if (res.status === 422) {
      console.error("RastroCode 422", o.transactionId, JSON.stringify(json));
      return err;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 1) {
      console.error(
        "RastroCode error",
        o.transactionId,
        res.status,
        JSON.stringify(json)?.slice(0, 500),
      );
      return err;
    }
    const retryAfter = Number(res.headers.get("Retry-After"));
    await sleep(
      Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000, 10_000),
    );
  }
  return { ok: false, error: "Sem resposta" };
}

/** Respostas definitivas: não reenviar. */
export const isRastroFinal = (r: RastroResult | undefined | null) =>
  !!r && (r.ok || [401, 402, 403, 413, 415, 422].includes(r.status ?? 0));
