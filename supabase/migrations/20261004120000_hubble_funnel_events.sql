-- Eventos de funil (visitas, produto, checkout e etapas do checkout).
-- Gravados somente pelo servidor (service role) via /api/public/event e /api/public/checkout-step.
CREATE TABLE IF NOT EXISTS public.funnel_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  path TEXT,
  bundle_id TEXT,
  bundle_name TEXT,
  value NUMERIC,
  referrer TEXT,
  user_agent TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_created_at ON public.funnel_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_funnel_events_session ON public.funnel_events (session_id);
CREATE INDEX IF NOT EXISTS idx_funnel_events_type ON public.funnel_events (event_type, created_at DESC);

GRANT ALL ON public.funnel_events TO service_role;
-- RLS ligado e sem políticas: anon/authenticated não leem nem escrevem.
ALTER TABLE public.funnel_events ENABLE ROW LEVEL SECURITY;
