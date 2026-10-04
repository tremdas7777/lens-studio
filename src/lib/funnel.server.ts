// Eventos de funil (visitas, produto, checkout e etapas do checkout) gravados pelo servidor.
// Nunca lança: rastreio não pode atrapalhar a compra.
import { isSupabaseConfigured } from "@/integrations/supabase/client.server";

/** Etapas do checkout, na ordem. "pix" = Pix gerado (o pagamento é conferido em orders). */
export const CHECKOUT_STEPS = ["checkout", "dados", "entrega", "pix"] as const;
export type CheckoutStep = (typeof CHECKOUT_STEPS)[number];

export const FUNNEL_EVENT_TYPES = ["page_view", "product_view", "checkout_click"] as const;

export type FunnelInsert = {
  session_id: string;
  event_type: string;
  path?: string | null;
  bundle_id?: string | null;
  bundle_name?: string | null;
  value?: number | null;
  referrer?: string | null;
  user_agent?: string | null;
  utm?: Record<string, string | null> | null | undefined;
  metadata?: Record<string, unknown> | null;
};

export async function insertFunnelEvent(e: FunnelInsert): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("funnel_events").insert({
      session_id: e.session_id,
      event_type: e.event_type,
      path: e.path ?? null,
      bundle_id: e.bundle_id ?? null,
      bundle_name: e.bundle_name ?? null,
      value: e.value ?? null,
      referrer: e.referrer ?? null,
      user_agent: e.user_agent ?? null,
      utm_source: e.utm?.["utm_source"] ?? null,
      utm_medium: e.utm?.["utm_medium"] ?? null,
      utm_campaign: e.utm?.["utm_campaign"] ?? null,
      metadata: e.metadata ?? null,
    });
    if (error) console.error("insertFunnelEvent error", error.message);
  } catch (err) {
    console.error("insertFunnelEvent failed", err);
  }
}
