// Origem do tráfego de um evento do funil (UTMs ou, sem UTM, o site de onde a pessoa veio).
// Usado no servidor (resumo por origem) e no /admin (tabela de eventos). Sem dependências de servidor.

export type OriginInput = {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  referrer?: string | null;
  metadata?: unknown;
};

export type TrafficOrigin = {
  /** facebook, instagram, google… ou "Direto". */
  source: string;
  medium: string | null;
  campaign: string | null;
  /** utm_content (normalmente o anúncio). */
  content: string | null;
  term: string | null;
  /** true = veio de UTM; false = deduzido do site de origem (ou direto). */
  tagged: boolean;
};

export const DIRECT = "Direto";

/** Nomes amigáveis para os sites de origem mais comuns. */
const REFERRER_NAMES: [RegExp, string][] = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)google\.[a-z.]+$/, "google"],
  [/(^|\.)(tiktok\.com)$/, "tiktok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "whatsapp"],
  [/(^|\.)(bing\.com)$/, "bing"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "x"],
];

const clean = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, 200) : null;
};

/** Site de origem (sem www), ou null se vazio/inválido/o próprio site. */
export function referrerSource(referrer: string | null | undefined, ownHost?: string | null) {
  if (!referrer) return null;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const own = (ownHost ?? "")
    .toLowerCase()
    .replace(/^www\./, "")
    .split(":")[0];
  if (!host || (own && host === own)) return null;
  for (const [re, name] of REFERRER_NAMES) if (re.test(host)) return name;
  return host;
}

export function originOf(e: OriginInput, ownHost?: string | null): TrafficOrigin {
  const meta = (e.metadata && typeof e.metadata === "object" ? e.metadata : {}) as Record<
    string,
    unknown
  >;
  const source = clean(e.utm_source);
  const content = clean(meta["utm_content"]);
  const term = clean(meta["utm_term"]);
  if (source) {
    return {
      source: source.toLowerCase(),
      medium: clean(e.utm_medium),
      campaign: clean(e.utm_campaign),
      content,
      term,
      tagged: true,
    };
  }
  return {
    source: referrerSource(e.referrer, ownHost) ?? DIRECT,
    medium: null,
    campaign: clean(e.utm_campaign),
    content,
    term,
    tagged: false,
  };
}
