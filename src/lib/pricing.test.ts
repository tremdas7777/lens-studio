import { describe, expect, it } from "vitest";
import { itemSchema, quote, PricingError, bumpOffer, type CartItemInput } from "@/lib/pricing";
import { computeStatus } from "@/lib/rastreio";
import { groupCheckoutEvents } from "@/lib/admin.functions";
import catalog from "@/lib/catalog.generated.json";

const lens = (planId: string, od: unknown = { kind: "miopia", sph: "-2.00" }, oe: unknown = null) =>
  itemSchema.parse({ kind: "lente", id: "skyhy", planId, od, oe, qty: 1 });

const anyFrame = Object.entries(catalog.frames)[0]!;
const sunFrame = Object.entries(catalog.frames).find(([, f]) => f.sun)!;
const nonSunFrame = Object.entries(catalog.frames).find(([, f]) => !f.sun);

describe("pricing", () => {
  it("cobra o ticket do plano SkyHy sem desconto Pix", () => {
    expect(quote({ items: [lens("1m")], bump: false, frete: "padrao" }).total).toBe(117);
    expect(() => quote({ items: [lens("1m")], bump: false, frete: "gratis" })).toThrow(/acima de R\$ 100/);
    expect(quote({ items: [lens("2m")], bump: false, frete: "gratis" }).total).toBe(147);
    expect(quote({ items: [lens("3m")], bump: false, frete: "gratis" }).totalCents).toBe(19700);
  });

  it("valida o sinal do grau e exige um olho", () => {
    expect(() => lens("1m", { kind: "miopia", sph: "+1.00" })).toThrow();
    expect(() => lens("1m", { kind: "hipermetropia", sph: "-1.00" })).toThrow();
    expect(() => lens("1m", { kind: "miopia", sph: "-1.10" })).toThrow();
    expect(() => quote({ items: [lens("1m", null, null)], bump: false, frete: "gratis" })).toThrow(
      PricingError,
    );
    expect(lens("1m", null, { kind: "hipermetropia", sph: "+2.50" })).toBeTruthy();
  });

  it("calcula óculos com adicionais", () => {
    const [id, f] = anyFrame;
    const it = itemSchema.parse({
      kind: "oculos",
      id,
      tipo: "grau",
      color: f.colors[0],
      uso: "visao-simples",
      lente: "alto-indice",
      filtroAzul: true,
      qty: 1,
    });
    expect(quote({ items: [it], bump: false, frete: "gratis" }).total).toBe(
      +(catalog.prices.glasses + 220 + 165).toFixed(2),
    );
    const [sid, sf] = sunFrame;
    const sun = itemSchema.parse({
      kind: "oculos",
      id: sid,
      tipo: "sol",
      color: sf.colors[0],
      uso: "sem-grau",
      qty: 1,
    });
    expect(quote({ items: [sun], bump: false, frete: "gratis" }).total).toBe(
      catalog.prices.sunglasses,
    );
    const sunBlue = { ...sun, filtroAzul: true } as CartItemInput;
    expect(() => quote({ items: [sunBlue], bump: false, frete: "gratis" })).toThrow(PricingError);
    const badColor = { ...sun, color: "Inexistente" } as CartItemInput;
    expect(() => quote({ items: [badColor], bump: false, frete: "gratis" })).toThrow(PricingError);
    if (nonSunFrame) {
      const [nid, nf] = nonSunFrame;
      const notSun = itemSchema.parse({
        kind: "oculos",
        id: nid,
        tipo: "sol",
        color: nf.colors[0],
        uso: "sem-grau",
        qty: 1,
      });
      expect(() => quote({ items: [notSun], bump: false, frete: "gratis" })).toThrow(PricingError);
    }
  });

  it("aplica bump e frete na mesma ordem do checkout.html", () => {
    // Colírio na oferta do checkout: preço fixo de R$ 37,90 (de R$ 70,90).
    const bump = 37.9;
    const q = quote({ items: [lens("2m")], bump: true, frete: "expresso" });
    expect(q.bump?.id).toBe("biotrue-hydration-boost-new");
    expect(q.bump).toMatchObject({ unitPrice: 37.9, details: { compareAt: 70.9 } });
    expect(q.discount).toBe(0);
    expect(q.total).toBe(+(147 + bump + 37.53).toFixed(2));
    expect(quote({ items: [lens("1m")], bump: false, frete: "padrao" }).total).toBe(117);
  });

  it("loja sem cupons: qualquer código é recusado", () => {
    for (const coupon of ["BEMVINDO10", "HUBBLE15", "XYZ"]) {
      expect(() =>
        quote({ items: [lens("3m")], bump: false, coupon, frete: "gratis" }),
      ).toThrow(/inválido/);
    }
  });

  it("oferta do checkout troca conforme o carrinho e some se o item já está no carrinho", () => {
    expect(bumpOffer([{ kind: "acessorio", id: "x" }])?.id).toBe(
      "optiplus-anti-fog-microfiber-cloth",
    );
    expect(
      bumpOffer([
        { kind: "lente", id: "skyhy" },
        { kind: "acessorio", id: "biotrue-hydration-boost-new" },
      ]),
    ).toBeNull();
  });
});

describe("rastreio", () => {
  it("estima a etapa pelos dias desde o pagamento", () => {
    const day = 864e5;
    const now = Date.now();
    expect(computeStatus(null, now)).toBe("aguardando_pagamento");
    expect(computeStatus(new Date(now - day).toISOString(), now)).toBe("pedido_recebido");
    expect(computeStatus(new Date(now - 8 * day).toISOString(), now)).toBe("em_transito");
    expect(computeStatus(new Date(now - 30 * day).toISOString(), now)).toBe("entregue");
  });
});

describe("checkouts abandonados", () => {
  it("agrupa por sessão mantendo a etapa mais avançada", () => {
    const ev = (step: string, t: string, m: Record<string, unknown> = {}) => ({
      session_id: "s1",
      created_at: t,
      bundle_name: "SkyHy",
      value: 267,
      utm_source: null,
      metadata: { step, ...m },
    });
    const g = groupCheckoutEvents([
      ev("checkout", "2026-10-01T10:00:00Z"),
      ev("entrega", "2026-10-01T10:02:00Z", { name: "Ana Souza" }),
      ev("dados", "2026-10-01T10:03:00Z", { email: "ANA@X.COM" }),
    ]).get("s1")!;
    expect(g.step).toBe("entrega");
    expect(g.name).toBe("Ana Souza");
    expect(g.email).toBe("ana@x.com");
  });
});
