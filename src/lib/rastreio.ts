/**
 * Linha do tempo de entrega exibida em /rastreio.html.
 *
 * Portado do rastreio da loja de origem: o andamento é ESTIMADO pelos dias desde a confirmação do
 * pagamento (não é consulta em transportadora). Quando a RastroCode devolve um código de
 * rastreio, ele é mostrado junto para o cliente consultar o status real.
 */
export type RastreioStatus =
  | "aguardando_pagamento"
  | "pedido_recebido"
  | "postado"
  | "em_transito"
  | "saiu_entrega"
  | "entregue";

export const RASTREIO_STEPS: {
  key: Exclude<RastreioStatus, "aguardando_pagamento">;
  title: string;
  sub: string;
}[] = [
  {
    key: "pedido_recebido",
    title: "Pedido recebido",
    sub: "Pagamento confirmado e pedido em separação",
  },
  { key: "postado", title: "Postado", sub: "Despachado pela transportadora" },
  { key: "em_transito", title: "Em trânsito", sub: "A caminho da sua cidade" },
  { key: "saiu_entrega", title: "Saiu para entrega", sub: "Com o entregador" },
  { key: "entregue", title: "Entregue", sub: "Pedido finalizado" },
];

export function computeStatus(paidAt: string | null, now = Date.now()): RastreioStatus {
  if (!paidAt) return "aguardando_pagamento";
  const days = (now - new Date(paidAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days >= 21) return "entregue";
  if (days >= 18) return "saiu_entrega";
  if (days >= 7) return "em_transito";
  if (days >= 3) return "postado";
  return "pedido_recebido";
}
