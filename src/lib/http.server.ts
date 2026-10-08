// Utilitários das rotas HTTP públicas (/api/public/*). Somente servidor.

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: NO_STORE });

export const fail = (status: number, error: string, extra?: Record<string, unknown>) =>
  json({ ok: false, error, ...extra }, status);

/**
 * CORS só na mesma origem: não enviamos Access-Control-Allow-Origin e recusamos requisições
 * cujo Origin (quando presente) seja de outro site. Preflight de outra origem também falha.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Sem Origin (GET same-origin, curl, webhook): confere o Sec-Fetch-Site quando houver.
    const site = request.headers.get("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  }
  try {
    const self = new URL(request.url);
    const fwdHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const o = new URL(origin);
    return o.host === self.host || (!!fwdHost && o.host === fwdHost);
  } catch {
    return false;
  }
}

/** Lê JSON com limite de tamanho. */
export async function readJson(request: Request, maxBytes = 32_000): Promise<unknown> {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new HttpError(413, "Requisição muito grande.");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Requisição muito grande.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function clientMeta(request: Request) {
  const h = request.headers;
  return {
    ip: h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    ua: h.get("user-agent")?.slice(0, 400) ?? null,
  };
}

/** Domínio público onde o cliente está comprando: Origin do navegador (já validado como mesma
 * origem), depois cabeçalhos do proxy, por fim a própria URL da requisição. */
export function publicOrigin(request: Request): string {
  const o = request.headers.get("origin");
  if (o && /^https?:\/\//.test(o)) return o;
  const host = request.headers.get("x-forwarded-host");
  if (host)
    return `${request.headers.get("x-forwarded-proto") ?? "https"}://${host.split(",")[0]!.trim()}`;
  return new URL(request.url).origin;
}

/**
 * Limite simples por IP (melhor esforço: memória do isolate/worker). Evita abuso
 * grosseiro do endpoint de checkout sem depender de infraestrutura extra.
 */
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  b.n++;
  return b.n <= max;
}

/** Envolve um handler: same-origin, erros conhecidos viram JSON com status. */
export function handler(
  fn: (ctx: { request: Request }) => Promise<Response>,
  opts: { sameOrigin?: boolean } = {},
) {
  return async ({ request }: { request: Request }) => {
    if (opts.sameOrigin !== false && !isSameOrigin(request))
      return fail(403, "Origem não permitida.");
    try {
      return await fn({ request });
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      if (e && typeof e === "object" && "issues" in e) {
        // ZodError
        const issues = (e as { issues: { path: (string | number)[]; message: string }[] }).issues;
        const first = issues[0];
        const pt = (m: string) =>
          m === "Required"
            ? "campo obrigatório"
            : /^(Invalid|Expected)/.test(m)
              ? "valor inválido"
              : m;
        return fail(
          422,
          first
            ? `Confira os dados (${first.path.join(".") || "dados"}: ${pt(first.message)}).`
            : "Dados inválidos.",
          {
            issues: issues
              .slice(0, 10)
              .map((i) => ({ path: i.path.join("."), message: i.message })),
          },
        );
      }
      console.error("api error", e);
      return fail(500, "Erro interno. Tente novamente em instantes.");
    }
  };
}
