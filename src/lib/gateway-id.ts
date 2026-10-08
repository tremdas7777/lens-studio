// Gateways suportados e referência da cobrança gravada em orders.gateway_id.
// Usado no servidor e no /admin (sem dependências de servidor).

/** Gateways Pix (um ativo por vez, escolhido no /admin). */
export const GATEWAYS = {
  pixgate: "PixGate",
  sagacepay: "SagacePay",
} as const;

export type GatewayId = keyof typeof GATEWAYS;
export const GATEWAY_IDS = Object.keys(GATEWAYS) as [GatewayId, ...GatewayId[]];

export const isGatewayId = (v: unknown): v is GatewayId =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(GATEWAYS, v);

/** Todos os gateways que podem aparecer num pedido: os de Pix + o de cartão (HyperCash). */
export const PAYMENT_GATEWAYS = { ...GATEWAYS, hypercash: "HyperCash" } as const;
export type PaymentGatewayId = keyof typeof PAYMENT_GATEWAYS;

const isPaymentGatewayId = (v: unknown): v is PaymentGatewayId =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(PAYMENT_GATEWAYS, v);

/**
 * Cada pedido guarda em qual gateway foi criado, como prefixo do id ("sagacepay:<id>",
 * "hypercash:<id>"). Sem prefixo = PixGate (todos os pedidos criados antes da troca). Assim, trocar
 * o gateway ativo no /admin não afeta cobranças já geradas: continuam sendo conferidas onde nasceram.
 */
export function encodeGatewayRef(gateway: PaymentGatewayId, txId: string): string {
  return gateway === "pixgate" ? txId : `${gateway}:${txId}`;
}

export function decodeGatewayRef(ref: string): { gateway: PaymentGatewayId; txId: string } {
  const i = ref.indexOf(":");
  const prefix = i > 0 ? ref.slice(0, i) : "";
  if (isPaymentGatewayId(prefix)) return { gateway: prefix, txId: ref.slice(i + 1) };
  return { gateway: "pixgate", txId: ref };
}

/** Pedido pago com cartão (HyperCash)? */
export const isCardRef = (ref: string | null | undefined) =>
  !!ref && decodeGatewayRef(ref).gateway === "hypercash";

/** Texto para o /admin: "SagacePay · <id>". */
export function gatewayLabel(ref: string): string {
  const { gateway, txId } = decodeGatewayRef(ref);
  return `${PAYMENT_GATEWAYS[gateway]} · ${txId}`;
}
