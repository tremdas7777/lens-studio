/**
 * Única regra de "pagamento confirmado" do site (servidor, webhook, página do pedido e admin).
 *
 * "approved" NÃO entra: a PixGate usa esse status para Pix gerado/ainda não pago — aceitar
 * "approved" faria pedidos pendentes virarem Purchase no Meta e venda paga na UTMify.
 */
const PAID_STATUSES = new Set(["paid", "pago", "completed", "concluido", "concluida", "confirmed"]);

export const isPaidStatus = (status: string | null | undefined) =>
  PAID_STATUSES.has(
    String(status ?? "")
      .trim()
      .toLowerCase(),
  );
