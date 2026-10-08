import { describe, expect, it } from "vitest";
import { trafficSources } from "@/lib/admin.functions";
import { DIRECT, originOf, referrerSource } from "@/lib/traffic-origin";

const HOST = "hubblelensbr.lovable.app";

describe("origem do tráfego", () => {
  it("usa as UTMs (fonte, meio, campanha e anúncio)", () => {
    expect(
      originOf({
        utm_source: "FB",
        utm_medium: "cpc",
        utm_campaign: "Lentes | Conversão",
        metadata: { utm_content: "video-01", step: "dados" },
      }),
    ).toEqual({
      source: "fb",
      medium: "cpc",
      campaign: "Lentes | Conversão",
      content: "video-01",
      term: null,
      tagged: true,
    });
  });

  it("sem UTM, mostra o site de onde veio; o próprio site e vazio contam como Direto", () => {
    expect(referrerSource("https://l.instagram.com/?u=x")).toBe("instagram");
    expect(referrerSource("https://www.google.com.br/")).toBe("google");
    expect(referrerSource("https://lm.facebook.com/l.php")).toBe("facebook");
    expect(referrerSource("https://blog.exemplo.com/post")).toBe("blog.exemplo.com");
    expect(originOf({ referrer: `https://${HOST}/lente.html` }, HOST).source).toBe(DIRECT);
    expect(originOf({ referrer: null }).source).toBe(DIRECT);
  });

  it("resumo por origem/campanha conta sessões únicas e pedidos", () => {
    const ev = (session_id: string, event_type: string, extra: Record<string, unknown> = {}) => ({
      session_id,
      event_type,
      ...extra,
    });
    const fb = { utm_source: "facebook", utm_campaign: "c1" };
    const rows = trafficSources(
      [
        // sessão A: facebook c1, viu produto e gerou pedido
        ev("A", "page_view", fb),
        ev("A", "product_view", fb),
        ev("A", "checkout_step", { ...fb, metadata: { step: "pix" } }),
        // sessão B: facebook c1, só visita
        ev("B", "page_view", fb),
        // sessão C: chegou sem UTM pelo Instagram
        ev("C", "page_view", { referrer: "https://l.instagram.com/" }),
        ev("C", "checkout_click", { referrer: `https://${HOST}/lente.html` }),
        // sessão D: primeiro evento sem UTM, depois com UTM → conta como a UTM
        ev("D", "page_view", {}),
        ev("D", "product_view", { utm_source: "google", utm_campaign: "busca" }),
      ],
      HOST,
    );
    expect(rows[0]).toMatchObject({
      source: "facebook",
      campaign: "c1",
      visitors: 2,
      viewedProduct: 1,
      checkout: 1,
      orders: 1,
    });
    expect(rows.find((r) => r.source === "instagram")).toMatchObject({
      visitors: 1,
      checkout: 1,
      orders: 0,
    });
    expect(rows.find((r) => r.source === "google")).toMatchObject({
      campaign: "busca",
      visitors: 1,
      viewedProduct: 1,
    });
    expect(rows.some((r) => r.source === DIRECT)).toBe(false);
  });
});
