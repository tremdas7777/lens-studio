// Gateway Pix (PixGate). Somente servidor.
// Chave salva no /admin (private_settings) ou, como reserva, em PIXGATE_API_KEY.
import { brand } from "@/lib/brand";
import { getPrivateSettings } from "@/lib/private-settings.server";

const API = "https://app.pixgateip.com/api";

export const PIX_UNAVAILABLE = "Pagamento indisponível no momento.";
export const PIXGATE_KEY = "pixgate_api_key";

export async function getPixGateKey(): Promise<{
  key: string | null;
  source: "db" | "env" | null;
}> {
  const fromDb = (await getPrivateSettings([PIXGATE_KEY])).get(PIXGATE_KEY);
  if (fromDb) return { key: fromDb, source: "db" };
  const fromEnv = process.env["PIXGATE_API_KEY"];
  return fromEnv ? { key: fromEnv, source: "env" } : { key: null, source: null };
}

async function apiKey(): Promise<string> {
  const { key } = await getPixGateKey();
  if (!key) throw new Error(PIX_UNAVAILABLE);
  return key;
}

/** Gera a cobrança Pix. Valor em centavos; a PixGate recebe reais (decimal). */
export async function gatewayCashin(o: {
  name: string;
  cpf: string;
  amountCents: number;
  postbackUrl: string;
}): Promise<{ id: string; qrcode: string; status: string }> {
  const valor = Number((o.amountCents / 100).toFixed(2));
  const res = await fetch(`${API}/v1/cashin`, {
    method: "POST",
    headers: {
      Apikey: await apiKey(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      nome: o.name,
      cpf: o.cpf,
      valor,
      // Descrição genérica — sem detalhes dos produtos.
      descricao: process.env["PIXGATE_CHARGE_DESCRIPTION"] || brand.chargeDescription,
      postback: o.postbackUrl,
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json().catch(() => null)) as any;
  const txId = json?.id;
  const qrcode = json?.pix;
  if (!res.ok || !txId || !qrcode) {
    console.error("PixGate error", res.status, JSON.stringify(json)?.slice(0, 500));
    throw new Error("Não foi possível gerar o Pix. Confira seus dados e tente novamente.");
  }
  return {
    id: String(txId),
    qrcode: String(qrcode),
    status: String(json?.status ?? "pending").toLowerCase(),
  };
}

/** Consulta o status real no gateway. Valor devolvido em centavos. */
export async function fetchGatewayStatus(id: string): Promise<{ status: string; amount: number }> {
  const res = await fetch(`${API}/stats/${encodeURIComponent(id)}`, {
    headers: { Apikey: await apiKey(), Accept: "application/json" },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = (await res.json().catch(() => null)) as any;
  // Só status e nomes dos campos no log (sem dados pessoais) para auditar a regra de "pago".
  console.log(
    "pixgate-status",
    id,
    JSON.stringify(json?.status),
    Object.keys(json ?? {}).join(","),
  );
  return {
    status: String(json?.status ?? "pending").toLowerCase(),
    amount: Math.round(Number(json?.value ?? 0) * 100),
  };
}
