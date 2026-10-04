/** Marca da loja — Hubble Brasil. */
export const brand = {
  name: "Hubble Brasil",
  shortName: "HUBBLE",
  /** Nome genérico enviado ao gateway na descrição da cobrança Pix. */
  chargeDescription: "Pedido Hubble",
  /** Identificador da plataforma nos envios à UTMify. */
  utmifyPlatform: "HubbleCheckout",
  /** Prefixo do número do pedido (HB-AAMM-NNNNN). */
  orderPrefix: "HB",
  colors: {
    navy: "#22547d",
    indigo: "#464ca7",
    rust: "#ad4000",
    ink: "#2b3235",
  },
} as const;
