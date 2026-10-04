# Hubble Brasil — loja + backend

Loja estática (HTML/CSS/JS, pt-BR) em `public/` servida pelo app **TanStack Start + Cloudflare**,
que também fornece o backend: checkout Pix com preço calculado no servidor, status do pedido,
rastreio, funil/checkouts abandonados e painel `/admin`.

This project was built with [Lovable](https://lovable.dev).

## Visão geral

| Peça | Onde |
| --- | --- |
| Loja (páginas `.html`, `assets/`) | `public/` — `/` redireciona para `/index.html` (`src/routes/index.tsx`) |
| Ponte loja ↔ API (UTMs, sessão, funil, Meta Pixel) | `public/assets/js/api.js` (incluído em todas as páginas depois de `app.js`) |
| API pública | `src/routes/api/public/*.ts` |
| Preços e catálogo (fonte da verdade) | `src/lib/pricing.ts` + `src/lib/catalog.generated.json` |
| Pedidos / Pix / relatórios | `src/lib/orders.server.ts`, `pixgate.server.ts`, `utmify.server.ts`, `meta.server.ts`, `rastrocode.server.ts` |
| Painel admin | `src/routes/admin.tsx` + `src/components/admin/*` + `src/lib/*.functions.ts` |
| Banco | `supabase/migrations/*.sql`, clientes em `src/integrations/supabase/` |

### O que foi portado da loja de origem (mesmo template)

- Cobrança Pix na **PixGate** (`/v1/cashin` + `/stats/:id`), regra única de “pago” (`pix-status.ts`),
  webhook `pix-webhook` que nunca confia no corpo e sempre reconsulta o gateway.
- Relatório **idempotente** do pagamento (`reportPaidOnce`, trava em `paid_reported_at`):
  **UTMify** (pendente ao gerar o Pix, pago na aprovação), **Meta Conversions API** (`Purchase`
  com `event_id = purchase-<orderId>`, deduplicado com o pixel do navegador) e **RastroCode**
  (gera código de rastreio do pedido pago).
- Funil de eventos (`funnel_events`), etapas do checkout e **checkouts abandonados**.
- `/admin` com abas **Funil**, **Pedidos** (filtros, busca, CSV, detalhe com Pix copia-e-cola,
  reconsulta de pagamento), **Checkouts abandonados** (com link de WhatsApp) e **Integrações**
  (token UTMify, Pixel/CAPI do Meta, diagnóstico de variáveis).
- Pixel do Meta no navegador (PageView, ViewContent em `lente.html`, InitiateCheckout no checkout,
  AddPaymentInfo ao chegar no pagamento) com espelho no servidor.
- Rastreio (status estimado pelos dias desde o pagamento + código da RastroCode quando houver).

Mudanças em relação à origem: pedidos ficam na tabela `orders` com `id` (uuid público usado no
polling), `number` (`HB-AAMM-NNNNN`) e `gateway_id`; o pedido é gravado **antes** da cobrança;
funil gravado pelo servidor (sem insert anônimo direto no Supabase); RLS sem políticas públicas;
senha do admin com comparação em tempo constante; sem toggle de WhatsApp, upsell pós-compra ou
tabela `rastreios` (não existem na loja Hubble).

## API pública (`/api/public/*`)

Todas respondem JSON, `Cache-Control: no-store`, só aceitam a **mesma origem** (sem CORS; `Origin`
de outro site → 403) e validam o corpo com zod (erro → `{ok:false, error}` com status 4xx).

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/api/public/checkout` | `{customer:{name,email,cpf,phone}, address:{cep,rua,numero,complemento,bairro,cidade,uf}, frete, coupon, bump, items:[…], rx:{method,…}, utm, sessionId, fbp, fbc, expectedTotal}` → recalcula o valor, grava o pedido, gera o Pix, avisa a UTMify (pendente) → `{orderId, number, qrcode, amount, expiresAt, totals, items}`. Limite: 8 tentativas / 10 min por IP. Se `expectedTotal` ≠ valor do servidor → 409. |
| GET | `/api/public/order?id=<orderId>` | Status público (`waiting_payment` / `paid` / `expired` / `failed`), valor, número, itens. Consulta o gateway (no máx. 1×/4 s por pedido) e, se pago, marca e dispara Meta CAPI + UTMify + RastroCode uma única vez. |
| POST | `/api/public/checkout-step` | `{sessionId, step:'checkout'|'dados'|'entrega', value, name?, email?, phone?, cidade?, uf?, frete?, bump?, utm}` — etapa `pix` é gravada pelo servidor. |
| POST | `/api/public/event` | `{sessionId, type:'page_view'|'product_view'|'checkout_click', …}` (funil do admin). |
| POST | `/api/public/meta-event` | Espelho CAPI dos eventos do pixel do navegador (mesmo `eventId`). |
| GET | `/api/public/settings` | `{metaPixelId}` (nunca tokens). |
| POST | `/api/public/pix-webhook` | Postback da PixGate (usa só o id da transação e reconsulta o gateway). |
| GET | `/api/public/rastreio?pedido=HB-…&cpf=…` | Número do pedido + CPF do titular → etapas de entrega e código de rastreio. Página: `public/rastreio.html`. |

Itens aceitos em `items`:

```js
{kind:'lente', id:'skyhy', planId:'1m'|'2m'|'3m', od:{kind:'miopia'|'hipermetropia', sph:'-2.00'}|null, oe:{…}|null, qty}
{kind:'oculos', id:'<armação>', tipo:'grau'|'sol', color:'<nome da cor>', uso:'visao-simples'|'leitura'|'sem-grau',
 lente:'policarbonato'|'alto-indice', filtroAzul:boolean, leitura?, rx?, od?, oe?, dp?, qty}
{kind:'acessorio', id:'<acessório>', qty}
```

## Como o preço é calculado (`src/lib/pricing.ts`)

O cliente só exibe; o servidor recalcula a partir dos ids. Mesma fórmula do `public/checkout.html`:

- **SkyHy by Hubble® Diária**: `1m` R$ 180,00 (2 caixas) · `2m` R$ 267,00 (4 caixas) · `3m` R$ 367,00 (6 caixas).
  Grau por olho: miopia sempre negativo, hipermetropia sempre positivo, passos de 0,25; pelo menos um olho.
- **Óculos**: armação de grau R$ 274,90 / sol R$ 329,90 (de `data.js`); + filtro de luz azul R$ 220,00
  (só grau); + alto índice 1.67 R$ 165,00. Armação, versão de sol e cor validadas contra o catálogo.
- **Acessórios**: preço de `data.js`.
- **Oferta do checkout (bump)**: 1 acessório a 60% do preço — `biotrue-hydration-boost-new` se o
  carrinho tem lente, senão `optiplus-anti-fog-microfiber-cloth` (não é oferecido se já estiver no carrinho).
- **Cupons**: `BEMVINDO10` (10%), `HUBBLE15` (15%, produtos ≥ R$ 300).
- **Frete**: `gratis` R$ 0 · `expresso` R$ 29,90.
- **Pix**: sem desconto (`PIX_OFF = 0`, igual ao `HB.PIX_OFF` da loja).

```
produtos = Σ(preço × qtd) + bump
cupom    = arred2(produtos × %)
total    = arred2(produtos − cupom + frete)
```

Catálogo de armações/acessórios: depois de editar `public/assets/js/data.js`, rode
`node scripts/gen-catalog.mjs` para regenerar `src/lib/catalog.generated.json` (e faça commit dele).

## Variáveis de ambiente (Lovable → Cloud / Secrets)

| Nome | Obrigatória | O que é |
| --- | --- | --- |
| `SUPABASE_URL` | sim | URL do projeto Supabase (servidor). |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | Chave service role (servidor; nunca vai ao navegador). |
| `PIXGATE_API_KEY` | sim | Chave da API PixGate. Sem ela o checkout responde “Pagamento indisponível no momento.” |
| `HUBBLE_ADMIN_PASSWORD` | sim | Senha do `/admin` (mín. 8 caracteres). |
| `PUBLIC_SITE_URL` | recomendada | Domínio público (ex.: `https://www.seudominio.com.br`), usado no postback da PixGate. Sem ela, usa o domínio da requisição. |
| `RASTROCODE_API_KEY` | opcional | Envia pedidos pagos à RastroCode e mostra o código de rastreio. |
| `PIXGATE_CHARGE_DESCRIPTION` | opcional | Descrição da cobrança no gateway (padrão “Pedido Hubble”). |
| `UTMIFY_API_TOKEN` | opcional | Token UTMify, se preferir env ao token salvo no `/admin` (o do admin tem prioridade). |
| `META_PIXEL_ID`, `META_CAPI_TOKEN`, `META_TEST_CODE` | opcional | Fallback do Pixel/CAPI se não configurados no `/admin`. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` | opcional | Só para o cliente anônimo `src/integrations/supabase/client.ts` (não usado pela loja hoje). |

UTMify e Pixel/CAPI do Meta são configurados pelo `/admin` → **Integrações** (ficam em `private_settings`).

## Banco de dados

Migrations em `supabase/migrations/`:

- `funnel_events` — eventos do funil e etapas do checkout.
- `private_settings` — tokens de integração (só service role).
- `orders` — pedidos Pix (cliente, endereço, itens, totais, receita, UTMs, resultado dos envios).

Todas com RLS ligado e **sem políticas públicas** (só o servidor acessa). Para aplicar:

- SQL Editor do Supabase (ou pelo Lovable, pedindo para rodar as migrations): execute cada
  arquivo, em ordem de nome.
- Supabase CLI: `supabase link --project-ref <ref>` e `supabase db push`.

`supabase/config.toml` não tem `project_id` de propósito.

## Desenvolvimento

```sh
bun install        # ou npm install
bun run dev        # http://localhost:8080 (ou a porta do Vite)
bun run test       # vitest (preços, rastreio, agrupamento de abandonos, rota "/")
bun run build
```

Sem as variáveis, a loja navega normalmente; o checkout mostra “Pagamento indisponível no momento.”
