// Escolha do gateway Pix. Somente servidor.
// - Pix NOVOS usam o gateway ativo (escolhido no /admin; padrão PixGate).
// - Conferência de pagamento usa SEMPRE o gateway em que o Pix foi criado (prefixo em gateway_id).
import {
  GATEWAYS,
  decodeGatewayRef,
  encodeGatewayRef,
  isGatewayId,
  type GatewayId,
} from "@/lib/gateway-id";
import { isPaidStatus as isPixGatePaid } from "@/lib/pix-status";
import { fetchGatewayStatus, gatewayCashin, getPixGateKey } from "@/lib/pixgate.server";
import { getPrivateSettings, setPrivateSettings } from "@/lib/private-settings.server";
import {
  getSagacePayKey,
  isSagacePayPaid,
  sagaceCashin,
  sagaceStatus,
} from "@/lib/sagacepay.server";

export const ACTIVE_GATEWAY_KEY = "payment_gateway";

export type CashinInput = {
  orderId: string;
  orderNumber: string;
  name: string;
  cpf: string;
  email: string;
  phone: string;
  amountCents: number;
  /** Origem pública do site (ex.: https://loja.com.br), sem barra no fim. */
  siteBase: string;
  expiresInSeconds: number;
};

type Adapter = {
  label: string;
  configured: () => Promise<boolean>;
  cashin: (o: CashinInput) => Promise<{ id: string; qrcode: string; status: string }>;
  status: (txId: string) => Promise<{ status: string; amount: number }>;
  isPaid: (status: string) => boolean;
};

const ADAPTERS: Record<GatewayId, Adapter> = {
  pixgate: {
    label: GATEWAYS.pixgate,
    configured: async () => Boolean((await getPixGateKey()).key),
    cashin: (o) =>
      gatewayCashin({
        name: o.name,
        cpf: o.cpf,
        amountCents: o.amountCents,
        postbackUrl: `${o.siteBase}/api/public/pix-webhook`,
      }),
    status: fetchGatewayStatus,
    isPaid: isPixGatePaid,
  },
  sagacepay: {
    label: GATEWAYS.sagacepay,
    configured: async () => Boolean((await getSagacePayKey()).key),
    cashin: (o) =>
      sagaceCashin({
        name: o.name,
        cpf: o.cpf,
        email: o.email,
        phone: o.phone,
        amountCents: o.amountCents,
        postbackUrl: `${o.siteBase}/api/public/sagacepay-webhook`,
        externalId: o.orderNumber,
        idempotencyKey: o.orderId,
        expiresInSeconds: o.expiresInSeconds,
      }),
    status: sagaceStatus,
    isPaid: isSagacePayPaid,
  },
};

export async function getActiveGateway(): Promise<GatewayId> {
  const v = (await getPrivateSettings([ACTIVE_GATEWAY_KEY])).get(ACTIVE_GATEWAY_KEY);
  return isGatewayId(v) ? v : "pixgate";
}

export async function setActiveGateway(id: GatewayId): Promise<void> {
  await setPrivateSettings([{ key: ACTIVE_GATEWAY_KEY, value: id }]);
}

export const isGatewayConfigured = (id: GatewayId) => ADAPTERS[id].configured();

/** Gera o Pix no gateway ativo. Devolve a referência já com o gateway (para gravar em gateway_id). */
export async function createCharge(
  gateway: GatewayId,
  o: CashinInput,
): Promise<{ ref: string; qrcode: string }> {
  const c = await ADAPTERS[gateway].cashin(o);
  return { ref: encodeGatewayRef(gateway, c.id), qrcode: c.qrcode };
}

/** Confere o pagamento no gateway em que o Pix foi criado. */
export async function checkCharge(
  ref: string,
): Promise<{ gateway: GatewayId; paid: boolean; status: string; amount: number }> {
  const { gateway, txId } = decodeGatewayRef(ref);
  const a = ADAPTERS[gateway];
  const { status, amount } = await a.status(txId);
  return { gateway, paid: a.isPaid(status), status, amount };
}
