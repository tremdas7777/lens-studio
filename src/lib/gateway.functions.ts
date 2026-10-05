import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-auth.server";
import { GATEWAY_IDS, type GatewayId } from "@/lib/gateway-id";

const pw = z.object({ password: z.string().min(1).max(200) });
const gw = z.enum(GATEWAY_IDS);

function mask(token: string): string {
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

async function keyOf(id: GatewayId) {
  if (id === "pixgate") return (await import("@/lib/pixgate.server")).getPixGateKey();
  return (await import("@/lib/sagacepay.server")).getSagacePayKey();
}

async function settingKey(id: GatewayId) {
  if (id === "pixgate") return (await import("@/lib/pixgate.server")).PIXGATE_KEY;
  return (await import("@/lib/sagacepay.server")).SAGACEPAY_KEY;
}

/** Gateway ativo + situação da chave de cada gateway (só a chave mascarada). */
export const getGatewayStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const { getActiveGateway } = await import("@/lib/gateway.server");
    const active = await getActiveGateway();
    const gateways = await Promise.all(
      GATEWAY_IDS.map(async (id) => {
        const { key, source } = await keyOf(id);
        return { id, configured: Boolean(key), source, maskedKey: key ? mask(key) : null };
      }),
    );
    return { active, gateways };
  });

export const saveGatewayKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    pw.extend({ gateway: gw, key: z.string().trim().min(10).max(300) }).parse(d),
  )
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const { setPrivateSettings } = await import("@/lib/private-settings.server");
    await setPrivateSettings([{ key: await settingKey(data.gateway), value: data.key.trim() }]);
    return { ok: true };
  });

export const deleteGatewayKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.extend({ gateway: gw }).parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const { getActiveGateway } = await import("@/lib/gateway.server");
    if ((await getActiveGateway()) === data.gateway) {
      throw new Error("Não dá para apagar a chave do gateway ativo. Ative o outro antes.");
    }
    const { deletePrivateSetting } = await import("@/lib/private-settings.server");
    await deletePrivateSetting(await settingKey(data.gateway));
    return { ok: true };
  });

/** Troca o gateway dos Pix NOVOS. Pix já gerados continuam no gateway em que nasceram. */
export const setActiveGatewayFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.extend({ gateway: gw }).parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const { isGatewayConfigured, setActiveGateway } = await import("@/lib/gateway.server");
    if (!(await isGatewayConfigured(data.gateway))) {
      throw new Error("Salve a chave deste gateway antes de ativá-lo.");
    }
    await setActiveGateway(data.gateway);
    return { ok: true };
  });

/** Confere se a chave funciona, sem gerar cobrança. */
export const testGatewayKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pw.extend({ gateway: gw }).parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    if (data.gateway === "sagacepay") {
      return (await import("@/lib/sagacepay.server")).sagaceTestKey();
    }
    // A PixGate não tem endpoint de teste sem cobrança: confere só se a chave existe.
    const { key } = await keyOf("pixgate");
    return key
      ? { ok: true, status: undefined, error: undefined }
      : { ok: false, status: undefined, error: "Sem chave" };
  });
