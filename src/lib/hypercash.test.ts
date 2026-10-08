import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderItem } from "@/lib/db-types";
import { decodeGatewayRef, encodeGatewayRef, gatewayLabel, isCardRef } from "@/lib/gateway-id";
import { checkCharge } from "@/lib/gateway.server";
import { createCardTransaction, isHypercashRefused } from "@/lib/hypercash.server";
import { maxInstallments } from "@/lib/pricing";
import { upsellKit, upsellSelection } from "@/lib/upsell";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("pedidos no cartão (HyperCash)", () => {
  it("referência leva o prefixo hypercash e é reconhecida como cartão", () => {
    const ref = encodeGatewayRef("hypercash", "tx-123");
    expect(ref).toBe("hypercash:tx-123");
    expect(decodeGatewayRef(ref)).toEqual({ gateway: "hypercash", txId: "tx-123" });
    expect(gatewayLabel(ref)).toBe("HyperCash · tx-123");
    expect(isCardRef(ref)).toBe(true);
    expect(isCardRef("sagacepay:1")).toBe(false);
    expect(isCardRef("123")).toBe(false);
    expect(isCardRef(null)).toBe(false);
  });

  it("recusado/cancelado encerram a cobrança; em análise não", () => {
    for (const s of ["refused", "REFUSED", "canceled", "cancelled", "failed"]) {
      expect(isHypercashRefused(s)).toBe(true);
    }
    for (const s of ["paid", "processing", "waiting_payment", "authorized", "", null]) {
      expect(isHypercashRefused(s)).toBe(false);
    }
  });

  it("parcelas: até 12x com parcela mínima de R$ 30", () => {
    expect(maxInstallments(29.9)).toBe(1);
    expect(maxInstallments(97)).toBe(3);
    expect(maxInstallments(197)).toBe(6);
    expect(maxInstallments(5000)).toBe(12);
  });
});

describe("HyperCash (fetch simulado)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env["HYPERCASH_SECRET_KEY"] = "sk_teste_0000000000";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    delete process.env["HYPERCASH_SECRET_KEY"];
  });

  it("cobra com o token do cartão e itens que somam o valor", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        id: "tx-1",
        status: "paid",
        amount: 11700,
        card: { brand: "visa", lastDigits: "4242" },
      }),
    );
    const tx = await createCardTransaction({
      amount: 11700,
      cardHash: "hash_do_sdk_0000",
      installments: 3,
      customer: {
        name: "Maria Teste",
        email: "m@example.com",
        phone: "11999999999",
        cpf: "52998224725",
      },
      address: {
        street: "Rua A",
        streetNumber: "10",
        complement: "Sem complemento",
        zipCode: "01001000",
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
        country: "BR",
      },
      shippingFee: 2000,
      items: [{ title: "Pedido Hubble", unitPrice: 9700, quantity: 1 }],
      postbackUrl: "https://loja.exemplo.com/api/public/hypercash-webhook",
    });
    expect(tx).toMatchObject({ id: "tx-1", status: "paid", card: { lastDigits: "4242" } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.hypercashbrasil.com.br/api/user/transactions");
    expect(init.headers.Authorization).toBe(`Basic ${btoa("x:sk_teste_0000000000")}`);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      amount: 11700,
      paymentMethod: "CREDIT_CARD",
      card: { hash: "hash_do_sdk_0000" },
      installments: 3,
      shipping: { fee: 2000 },
    });
    const itemsSum = body.items.reduce(
      (s: number, i: { unitPrice: number; quantity: number }) => s + i.unitPrice * i.quantity,
      0,
    );
    expect(itemsSum + body.shipping.fee).toBe(body.amount);
  });

  it("confere o status em GET /transactions/:id", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "tx-1", status: "paid", amount: 11700 }));
    const paid = await checkCharge("hypercash:tx-1");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.hypercashbrasil.com.br/api/user/transactions/tx-1",
    );
    expect(paid).toMatchObject({ gateway: "hypercash", paid: true, refused: false, amount: 11700 });

    fetchMock.mockResolvedValueOnce(json({ id: "tx-2", status: "refused", amount: 11700 }));
    expect(await checkCharge("hypercash:tx-2")).toMatchObject({ paid: false, refused: true });
  });
});

describe("ofertas pós-compra", () => {
  const lens: OrderItem = {
    kind: "lente",
    id: "skyhy",
    name: "SkyHy by Hubble® Diária",
    qty: 2,
    unitPrice: 147,
    meta: ["OD: Miopia -2,00", "Plano 2 meses · 4 caixas de 30 lentes (2 para cada olho)"],
    details: { planId: "2m", od: { kind: "miopia", sph: -2 } },
  };
  const glasses: OrderItem = {
    kind: "oculos",
    id: "lyra",
    name: "Óculos de Grau Lyra",
    qty: 1,
    unitPrice: 397,
    meta: [],
    details: {},
  };
  const bump: OrderItem = {
    kind: "acessorio",
    id: "biotrue",
    name: "Biotrue",
    qty: 1,
    unitPrice: 30,
    meta: ["Oferta do checkout"],
    details: { bump: true },
  };

  it("kit = o mesmo plano de lentes (mesmo grau), 1 unidade, com 50% OFF", () => {
    const k = upsellKit([glasses, lens, bump])!;
    expect(k).toMatchObject({ kind: "lente", id: "skyhy", qty: 1, unitPrice: 73.5 });
    expect(k.details).toMatchObject({ planId: "2m", upsell: true, compareAt: 147 });
  });

  it("sem lentes, o kit é o item mais caro (nunca a oferta do checkout)", () => {
    expect(upsellKit([bump, glasses])).toMatchObject({ id: "lyra", unitPrice: 198.5 });
    expect(upsellKit([bump])).toBeNull();
  });

  it("seleção: kit + seguro numa cobrança; entrega prioritária separada", () => {
    const s = upsellSelection([lens, bump], ["seguro", "kit", "kit", "outro"]);
    expect(s.products).toEqual(["kit", "seguro"]);
    expect(s.total).toBe(103.4);
    expect(s.items.map((i) => i.kind)).toEqual(["lente", "servico"]);
    const e = upsellSelection([lens], ["expresso"]);
    expect(e).toMatchObject({ products: ["expresso"], total: 19.9 });
  });
});
