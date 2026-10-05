// Gateways Pix suportados e referência da cobrança gravada em orders.gateway_id.
// Usado no servidor e no /admin (sem dependências de servidor).

export const GATEWAYS = {
  pixgate: "PixGate",
  sagacepay: "SagacePay",
} as const;

export type GatewayId = keyof typeof GATEWAYS;
export const GATEWAY_IDS = Object.keys(GATEWAYS) as [GatewayId, ...GatewayId[]];

export const isGatewayId = (v: unknown): v is GatewayId =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(GATEWAYS, v);

/**
 * Cada pedido guarda em qual gateway foi criado, como prefixo do id ("sagacepay:<id>").
 * Sem prefixo = PixGate (todos os pedidos criados antes da troca). Assim, trocar o gateway
 * ativo no /admin não afeta Pix já gerados: eles continuam sendo conferidos onde nasceram.
 */
export function encodeGatewayRef(gateway: GatewayId, txId: string): string {
  return gateway === "pixgate" ? txId : `${gateway}:${txId}`;
}

export function decodeGatewayRef(ref: string): { gateway: GatewayId; txId: string } {
  const i = ref.indexOf(":");
  const prefix = i > 0 ? ref.slice(0, i) : "";
  if (isGatewayId(prefix)) return { gateway: prefix, txId: ref.slice(i + 1) };
  return { gateway: "pixgate", txId: ref };
}

/** Texto para o /admin: "SagacePay · <id>". */
export function gatewayLabel(ref: string): string {
  const { gateway, txId } = decodeGatewayRef(ref);
  return `${GATEWAYS[gateway]} · ${txId}`;
}
