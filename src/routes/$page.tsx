import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

// Páginas da loja sem ".html" (ex.: /checkout, /carrinho, /lente?id=skyhy) abrem a página certa.
// A UTMify marca o checkout pelo endereço "…/checkout", e links/anúncios sem a extensão davam 404.
const STATIC_PAGES = new Set([
  "acessorio",
  "acessorios",
  "busca",
  "carrinho",
  "checkout",
  "como-funciona",
  "conta",
  "contato",
  "entrega-prioritaria",
  "faq",
  "index",
  "legal",
  "lente",
  "lentes-de-contato",
  "obrigado",
  "oculos",
  "oculos-produto",
  "oferta",
  "pedido-confirmado",
  "rastreio",
  "sobre",
  "testes-de-visao",
]);

export const Route = createFileRoute("/$page")({
  beforeLoad: ({ params, location }) => {
    const page = params.page.toLowerCase();
    if (!STATIC_PAGES.has(page)) throw notFound();
    throw redirect({ href: `/${page}.html${location.searchStr}`, statusCode: 301 });
  },
});
