-- Configurações privadas (tokens de integração: Meta Pixel/CAPI, UTMify), editadas no /admin.
-- Só o servidor (service role) acessa. Nenhum valor é semeado aqui.
CREATE TABLE IF NOT EXISTS public.private_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.private_settings TO service_role;
ALTER TABLE public.private_settings ENABLE ROW LEVEL SECURITY;
