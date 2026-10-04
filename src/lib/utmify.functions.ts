import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-auth.server";
import {
  deleteUtmifyToken,
  getUtmifyToken,
  saveUtmifyToken,
  sendUtmifyOrder,
} from "@/lib/utmify.server";

const pw = z.object({ password: z.string().min(1).max(200) });

function mask(token: string): string {
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

export const getUtmifyStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const { token, source } = await getUtmifyToken();
    return { configured: Boolean(token), source, maskedToken: token ? mask(token) : null };
  });

export const saveUtmifyTokenFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.extend({ token: z.string().min(10).max(200) }).parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    await saveUtmifyToken(data.token.trim());
    return { ok: true };
  });

export const deleteUtmifyTokenFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    await deleteUtmifyToken();
    return { ok: true };
  });

export const sendUtmifyTest = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    pw.extend({ status: z.enum(["paid", "waiting_payment"]).default("paid") }).parse(d),
  )
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const pending = data.status === "waiting_payment";
    // isTest: a UTMify valida token e formato, mas o pedido NÃO entra nas vendas.
    return sendUtmifyOrder({
      isTest: true,
      orderId: `teste-${pending ? "pendente" : "pago"}-${Date.now()}`,
      status: data.status,
      createdAt: Date.now(),
      approvedAt: pending ? null : Date.now(),
      customer: {
        name: "Maria Teste Silva",
        email: "maria.teste@exemplo.com",
        phone: "11999999999",
        document: "52998224725",
      },
      product: { id: "hubble-pedido", name: "SkyHy by Hubble® Diária - 2 meses" },
      amountCents: 26700,
      utm: { utm_source: "teste" },
    });
  });
