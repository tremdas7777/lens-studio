// Meta Conversions API (servidor). Nunca lança: falha no Meta não quebra a loja.
// Config em private_settings (via /admin); META_PIXEL_ID / META_CAPI_TOKEN / META_TEST_CODE (env) são fallback.
import { getPrivateSettings, setPrivateSettings } from "@/lib/private-settings.server";

/**
 * Quem manda os eventos ao Meta: a loja (pixel + API de Conversões daqui) ou a UTMify (pixel dela
 * conectado ao Meta no painel da UTMify). Nunca os dois, senão tudo conta duas vezes.
 * Sem escolha salva no /admin = UTMify.
 */
export type MetaSource = "loja" | "utmify";
export const META_SOURCE_KEY = "meta_events_source";
/** Contém "não configurado": o reportPaidOnce não fica tentando de novo. */
export const STORE_META_OFF = "Envio pela loja não configurado: a UTMify manda os eventos ao Meta";

export type MetaConfig = {
  pixelId: string | null;
  accessToken: string | null;
  testCode: string | null;
  source: MetaSource;
};

const KEYS = ["meta_pixel_id", "meta_access_token", "meta_test_code", META_SOURCE_KEY] as const;

export async function getMetaConfig(): Promise<MetaConfig> {
  const m = await getPrivateSettings(KEYS);
  return {
    pixelId: m.get("meta_pixel_id") || process.env["META_PIXEL_ID"] || null,
    accessToken: m.get("meta_access_token") || process.env["META_CAPI_TOKEN"] || null,
    testCode: m.get("meta_test_code") || process.env["META_TEST_CODE"] || null,
    source: m.get(META_SOURCE_KEY) === "loja" ? "loja" : "utmify",
  };
}

export async function setMetaSource(source: MetaSource): Promise<void> {
  await setPrivateSettings([{ key: META_SOURCE_KEY, value: source }]);
}

export async function saveMetaConfig(c: {
  pixelId: string;
  accessToken?: string | undefined;
  testCode: string;
}) {
  const rows = [
    { key: "meta_pixel_id", value: c.pixelId },
    { key: "meta_test_code", value: c.testCode },
  ];
  // Token só é substituído quando um novo é digitado.
  if (c.accessToken) rows.push({ key: "meta_access_token", value: c.accessToken });
  await setPrivateSettings(rows);
}

async function sha(v: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(v.trim().toLowerCase()),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type CapiUser = {
  email?: string | undefined;
  phone?: string | undefined; // só dígitos, com ou sem 55
  name?: string | undefined;
  cpf?: string | undefined;
  ip?: string | null | undefined;
  ua?: string | null | undefined;
  fbp?: string | null | undefined;
  fbc?: string | null | undefined;
};

export type CapiEvent = {
  eventName: string;
  eventId: string;
  url?: string | undefined;
  user: CapiUser;
  customData?: Record<string, unknown> | undefined;
};

export async function sendCapiEvent(ev: CapiEvent): Promise<{ ok: boolean; error?: string }> {
  try {
    const cfg = await getMetaConfig();
    if (cfg.source !== "loja") return { ok: false, error: STORE_META_OFF };
    if (!cfg.pixelId || !cfg.accessToken)
      return { ok: false, error: "Pixel ou token não configurado" };
    const u = ev.user;
    const [fn, ...rest] = (u.name ?? "").trim().split(/\s+/);
    const ln = rest.pop();
    const phone = u.phone?.replace(/\D/g, "");
    const user_data: Record<string, unknown> = {
      client_ip_address: u.ip ?? undefined,
      client_user_agent: u.ua ?? undefined,
      fbp: u.fbp ?? undefined,
      fbc: u.fbc ?? undefined,
      em: u.email ? [await sha(u.email)] : undefined,
      ph: phone ? [await sha(phone.startsWith("55") ? phone : `55${phone}`)] : undefined,
      fn: fn ? [await sha(fn)] : undefined,
      ln: ln ? [await sha(ln)] : undefined,
      external_id: u.cpf ? [await sha(u.cpf.replace(/\D/g, ""))] : undefined,
      country: [await sha("br")],
    };
    const body: Record<string, unknown> = {
      data: [
        {
          event_name: ev.eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: ev.eventId,
          action_source: "website",
          event_source_url: ev.url,
          user_data,
          custom_data: ev.customData,
        },
      ],
    };
    if (cfg.testCode) body["test_event_code"] = cfg.testCode;
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(cfg.pixelId)}/events?access_token=${encodeURIComponent(cfg.accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error("Meta CAPI error", res.status, t.slice(0, 300));
      return { ok: false, error: t.slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    console.error("Meta CAPI failed", e);
    return { ok: false, error: "Falha de conexão" };
  }
}
