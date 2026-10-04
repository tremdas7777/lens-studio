import { createFileRoute, redirect } from "@tanstack/react-router";

// A loja é um site estático em /public (páginas .html). A raiz abre a página inicial.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ href: "/index.html", statusCode: 302 });
  },
});
