import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { handler, json, readJson } from "@/lib/http.server";
import { CHECKOUT_STEPS, insertFunnelEvent } from "@/lib/funnel.server";

const stepSchema = z.object({
  sessionId: z.string().regex(/^[\w-]{8,64}$/),
  // "pix" é registrado pelo próprio servidor ao criar o pedido.
  step: z.enum(CHECKOUT_STEPS).exclude(["pix"]),
  plano: z.string().max(80).optional(),
  planoNome: z.string().max(200).optional(),
  value: z.number().min(0).max(1_000_000).optional(),
  // Contato só para recuperar o carrinho — sem CPF.
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().max(160).optional(),
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, "").slice(0, 13))
    .optional(),
  cidade: z.string().trim().max(80).optional(),
  uf: z.string().trim().max(2).optional(),
  frete: z.string().max(20).optional(),
  bump: z.boolean().optional(),
  items: z.number().int().min(0).max(100).optional(),
  utm: z.record(z.string().max(40), z.string().max(300).nullable()).optional(),
});

// POST /api/public/checkout-step — etapa concluída no checkout (checkouts abandonados no /admin).
// Nunca falha por causa do banco: rastreio não pode atrapalhar a compra.
export const Route = createFileRoute("/api/public/checkout-step")({
  server: {
    handlers: {
      POST: handler(async ({ request }) => {
        const data = stepSchema.parse(await readJson(request, 8_000));
        const { sessionId, step, plano, planoNome, value, utm, ...rest } = data;
        await insertFunnelEvent({
          session_id: sessionId,
          event_type: "checkout_step",
          path: "/checkout.html",
          bundle_id: plano ?? null,
          bundle_name: planoNome ?? null,
          value: value ?? null,
          utm,
          metadata: { step, ...rest },
        });
        return json({ ok: true });
      }),
    },
  },
});
