// Tipos das linhas das tabelas (formato usado pela app).
import type { Json } from "@/integrations/supabase/types";
export type { Json };
export type JsonObject = { [key: string]: Json | undefined };

export type FunnelEventRow = {
  id: string;
  session_id: string;
  event_type: string;
  path: string | null;
  bundle_id: string | null;
  bundle_name: string | null;
  value: number | null;
  referrer: string | null;
  user_agent: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  metadata: Json | null;
  created_at: string;
};

export type OrderAddress = {
  cep: string;
  rua: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export type OrderCustomer = { name: string; email: string; phone: string; cpf: string };

export type OrderItem = {
  kind: "lente" | "oculos" | "acessorio";
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  meta: string[];
  details: JsonObject;
};

export type OrderTotals = {
  sub: number;
  discount: number;
  coupon: { code: string; pct: number; label: string } | null;
  pix: number;
  shipping: number;
  total: number;
  frete: { id: string; name: string; eta: string; price: number };
  bump: OrderItem | null;
};

export type OrderRow = {
  id: string;
  number: string;
  gateway_id: string | null;
  status: string;
  amount_cents: number;
  customer: OrderCustomer;
  address: OrderAddress;
  items: OrderItem[];
  totals: OrderTotals;
  summary: string;
  rx: JsonObject | null;
  qrcode: string | null;
  expires_at: string | null;
  session_id: string | null;
  utm: Record<string, string | null> | null;
  fbp: string | null;
  fbc: string | null;
  ip: string | null;
  ua: string | null;
  url: string | null;
  paid_at: string | null;
  paid_reported_at: string | null;
  report_result: JsonObject | null;
  created_at: string;
  updated_at: string;
};
