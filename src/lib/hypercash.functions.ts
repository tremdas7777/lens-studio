import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-auth.server";

const pw = z.object({ password: z.string().min(1).max(200) });

function mask(token: string): string {
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

/** Situação do cartão: ligado/desligado + chaves (só mascaradas). */
export const getHypercashStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const { getHypercashKeys, isCardEnabled } = await import("@/lib/hypercash.server");
    const k = await getHypercashKeys();
    const view = (i: { key: string | null; source: "db" | "env" | null }) => ({
      masked: i.key ? mask(i.key) : null,
      source: i.source,
    });
    return {
      enabled: await isCardEnabled(),
      secret: view(k.secret),
      public: view(k.public),
    };
  });

export const saveHypercashKeysFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    pw
      .extend({
        secret: z.string().trim().min(10).max(500).optional(),
        public: z.string().trim().min(10).max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const { HYPERCASH_PUBLIC, HYPERCASH_SECRET } = await import("@/lib/hypercash.server");
    const rows = [
      ...(data.secret ? [{ key: HYPERCASH_SECRET, value: data.secret }] : []),
      ...(data.public ? [{ key: HYPERCASH_PUBLIC, value: data.public }] : []),
    ];
    if (!rows.length) return { ok: true };
    const { setPrivateSettings } = await import("@/lib/private-settings.server");
    await setPrivateSettings(rows);
    return { ok: true };
  });

export const deleteHypercashKeysFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const { HYPERCASH_PUBLIC, HYPERCASH_SECRET } = await import("@/lib/hypercash.server");
    const { deletePrivateSetting } = await import("@/lib/private-settings.server");
    await deletePrivateSetting(HYPERCASH_SECRET);
    await deletePrivateSetting(HYPERCASH_PUBLIC);
    return { ok: true };
  });

/** Valida a chave secreta sem gerar cobrança nenhuma. */
export const testHypercashFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    return (await import("@/lib/hypercash.server")).testHypercashSecret();
  });

/** Liga/desliga o cartão no checkout para os clientes. */
export const setCardEnabledFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.extend({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const { getHypercashKeys, setCardEnabled } = await import("@/lib/hypercash.server");
    if (data.enabled) {
      const k = await getHypercashKeys();
      if (!k.secret.key || !k.public.key) {
        throw new Error("Salve a chave pública e a chave secreta antes de ativar o cartão.");
      }
    }
    await setCardEnabled(data.enabled);
    return { enabled: data.enabled };
  });
