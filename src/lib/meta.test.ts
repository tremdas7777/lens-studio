import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMetaConfig, sendCapiEvent, STORE_META_OFF } from "@/lib/meta.server";

describe("quem manda os eventos ao Meta", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env["META_PIXEL_ID"] = "1999343270690469";
    process.env["META_CAPI_TOKEN"] = "EAA_teste_000000";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    delete process.env["META_PIXEL_ID"];
    delete process.env["META_CAPI_TOKEN"];
  });

  it("sem escolha salva, a UTMify manda e a loja não envia nada (nem a compra)", async () => {
    expect((await getMetaConfig()).source).toBe("utmify");
    const r = await sendCapiEvent({
      eventName: "Purchase",
      eventId: "purchase-teste",
      user: { email: "maria.teste@example.com" },
    });
    expect(r).toEqual({ ok: false, error: STORE_META_OFF });
    expect(fetchMock).not.toHaveBeenCalled();
    // "não configurado" faz o reportPaidOnce não ficar tentando de novo.
    expect(STORE_META_OFF).toMatch(/não configurad/i);
  });
});
