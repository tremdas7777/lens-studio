import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { handler, json, readJson } from "@/lib/http.server";

// POST /api/public/card-config — cartão (HyperCash) disponível no checkout + chave PÚBLICA do SDK.
// A chave secreta nunca sai do servidor. Com o cartão desligado no /admin, só quem está logado
// no admin (senha da mesma aba) recebe a chave, para testar.
export const Route = createFileRoute("/api/public/card-config")({
  server: {
    handlers: {
      POST: handler(async ({ request }) => {
        const body = z
          .object({ adminPassword: z.string().max(200).optional() })
          .catch({})
          .parse(await readJson(request, 2_000).catch(() => ({})));
        const { cardAvailability } = await import("@/lib/hypercash.server");
        const { MAX_INSTALLMENTS, MIN_INSTALLMENT } = await import("@/lib/pricing");
        const c = await cardAvailability(body.adminPassword).catch(() => null);
        return json({
          ok: true,
          enabled: !!c?.enabled,
          publicKey: c?.publicKey ?? null,
          maxInstallments: MAX_INSTALLMENTS,
          minInstallment: MIN_INSTALLMENT,
        });
      }),
    },
  },
});
