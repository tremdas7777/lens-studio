import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-auth.server";
import { getMetaConfig, saveMetaConfig, sendCapiEvent, setMetaSource } from "@/lib/meta.server";

const pw = z.object({ password: z.string().min(1).max(200) });

export const getMetaAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const c = await getMetaConfig();
    return {
      pixelId: c.pixelId ?? "",
      testCode: c.testCode ?? "",
      hasToken: Boolean(c.accessToken),
      tokenHint: c.accessToken ? `••••${c.accessToken.slice(-4)}` : "",
      source: c.source,
    };
  });

/** Escolhe quem manda os eventos ao Meta: a loja ou a UTMify (nunca os dois). */
export const setMetaSourceAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.extend({ source: z.enum(["loja", "utmify"]) }).parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    await setMetaSource(data.source);
    return { source: data.source };
  });

export const saveMetaAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    pw
      .extend({
        pixelId: z
          .string()
          .trim()
          .regex(/^\d{5,25}$/, "ID do pixel deve ter só números"),
        accessToken: z.string().trim().max(600).optional(),
        testCode: z.string().trim().max(40).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    await saveMetaConfig({
      pixelId: data.pixelId,
      accessToken: data.accessToken || undefined,
      testCode: data.testCode,
    });
    return { ok: true };
  });

export const testMetaAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.extend({ siteUrl: z.string().url().max(300) }).parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    // Teste = compra paga (Purchase), igual ao enviado quando o Pix cai. Use com código de teste.
    return sendCapiEvent({
      eventName: "Purchase",
      eventId: `test-purchase-${Date.now()}`,
      url: data.siteUrl,
      user: { email: "maria.teste@example.com", name: "Maria Teste Silva" },
      customData: {
        value: 267,
        currency: "BRL",
        content_name: "Pedido de teste",
        content_type: "product",
      },
    });
  });
