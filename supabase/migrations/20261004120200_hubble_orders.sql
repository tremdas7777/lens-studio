-- Pedidos (Pix). Valor sempre calculado no servidor (src/lib/pricing.ts).
-- id (uuid) é o identificador público do pedido usado no polling (/api/public/order?id=);
-- number é o número exibido ao cliente (HB-AAMM-NNNNN); gateway_id é a transação na PixGate.
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT NOT NULL UNIQUE,
  gateway_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'creating', -- creating | waiting_payment | paid | failed | expired
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  customer JSONB NOT NULL,      -- {name,email,phone,cpf}
  address JSONB NOT NULL,       -- {cep,rua,numero,complemento,bairro,cidade,uf}
  items JSONB NOT NULL,         -- [{kind,id,name,qty,unitPrice,meta,details}]
  totals JSONB NOT NULL,        -- {sub,discount,coupon,pix,shipping,total,frete,bump}
  summary TEXT NOT NULL DEFAULT '',
  rx JSONB,                     -- {method, fileName?, doctor?}
  qrcode TEXT,                  -- Pix copia e cola
  expires_at TIMESTAMPTZ,
  session_id TEXT,
  utm JSONB,
  fbp TEXT,
  fbc TEXT,
  ip TEXT,
  ua TEXT,
  url TEXT,
  paid_at TIMESTAMPTZ,
  paid_reported_at TIMESTAMPTZ, -- trava de idempotência dos envios UTMify/Meta/RastroCode
  report_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_email ON public.orders ((lower(customer->>'email')));

GRANT ALL ON public.orders TO service_role;
-- RLS ligado e sem políticas: só o servidor (service role) acessa dados de clientes.
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
