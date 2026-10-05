import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeGatewayRef, encodeGatewayRef, gatewayLabel } from "@/lib/gateway-id";
import { checkCharge, createCharge, getActiveGateway } from "@/lib/gateway.server";
import { isSagacePayPaid } from "@/lib/sagacepay.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const input = {
  orderId: "0b8c7a52-1d1e-4a3f-9d0b-6f4f3c2a1b00",
  orderNumber: "HB-2610-00001",
  name: "Maria Teste Silva",
  cpf: "52998224725",
  email: "maria.teste@example.com",
  phone: "11999999999",
  amountCents: 14700,
  siteBase: "https://loja.exemplo.com",
  expiresInSeconds: 1800,
};

describe("referência do gateway no pedido", () => {
  it("pedidos antigos (sem prefixo) continuam na PixGate", () => {
    expect(decodeGatewayRef("123456")).toEqual({ gateway: "pixgate", txId: "123456" });
    expect(encodeGatewayRef("pixgate", "123456")).toBe("123456");
  });

  it("pedidos da SagacePay levam prefixo", () => {
    const ref = encodeGatewayRef("sagacepay", "a1b2-c3");
    expect(ref).toBe("sagacepay:a1b2-c3");
    expect(decodeGatewayRef(ref)).toEqual({ gateway: "sagacepay", txId: "a1b2-c3" });
    expect(gatewayLabel(ref)).toBe("SagacePay · a1b2-c3");
  });

  it("prefixo desconhecido é tratado como id da PixGate", () => {
    expect(decodeGatewayRef("abc:123")).toEqual({ gateway: "pixgate", txId: "abc:123" });
  });
});

describe("regra de pago da SagacePay", () => {
  it("só paid conta como venda", () => {
    expect(isSagacePayPaid("paid")).toBe(true);
    expect(isSagacePayPaid("PAID")).toBe(true);
    for (const s of ["pending", "failed", "refunded", "expired", "", null]) {
      expect(isSagacePayPaid(s)).toBe(false);
    }
  });
});

describe("gateways (fetch simulado)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env["SAGACEPAY_API_KEY"] = "sk_live_teste_0000000000";
    process.env["PIXGATE_API_KEY"] = "pixgate_teste_0000000000";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    delete process.env["SAGACEPAY_API_KEY"];
    delete process.env["PIXGATE_API_KEY"];
  });

  it("sem configuração salva, o gateway ativo é a PixGate", async () => {
    expect(await getActiveGateway()).toBe("pixgate");
  });

  it("SagacePay: cria a venda com os campos da documentação", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ id: "sale-1", status: "pending", amount: 147, pixCode: "000201PIX" }, 201),
    );
    const c = await createCharge("sagacepay", input);
    expect(c).toEqual({ ref: "sagacepay:sale-1", qrcode: "000201PIX" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://sagacepay.com/api/sales");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("sk_live_teste_0000000000");
    expect(init.headers["idempotency-key"]).toBe(input.orderId);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      amount: 147,
      expirationInSeconds: 1800,
      customer: { name: input.name, document: input.cpf, email: input.email, phone: input.phone },
      postbackUrl: "https://loja.exemplo.com/api/public/sagacepay-webhook",
      externalId: input.orderNumber,
    });
    expect(body.tracking).toBeUndefined();
  });

  it("SagacePay: erro na criação não gera pedido com Pix vazio", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "API Key inválida", statusCode: 401 }, 401));
    await expect(createCharge("sagacepay", input)).rejects.toThrow(/Não foi possível gerar o Pix/);
  });

  it("SagacePay: confere o status em GET /sales/:id", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "sale-1", status: "paid", amount: 147 }));
    const r = await checkCharge("sagacepay:sale-1");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://sagacepay.com/api/sales/sale-1");
    expect(r).toMatchObject({ gateway: "sagacepay", paid: true, amount: 14700 });

    fetchMock.mockResolvedValueOnce(json({ id: "sale-2", status: "pending", amount: 97 }));
    expect((await checkCharge("sagacepay:sale-2")).paid).toBe(false);
  });

  it("PixGate: pedidos antigos continuam sendo conferidos na PixGate", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: "approved", value: 97 }));
    const pend = await checkCharge("987654");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("app.pixgateip.com/api/stats/987654");
    // "approved" na PixGate = Pix gerado, ainda não pago.
    expect(pend).toMatchObject({ gateway: "pixgate", paid: false });

    fetchMock.mockResolvedValueOnce(json({ status: "paid", value: 97 }));
    expect(await checkCharge("987654")).toMatchObject({ paid: true, amount: 9700 });
  });
});
