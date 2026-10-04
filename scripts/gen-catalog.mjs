#!/usr/bin/env node
// Gera src/lib/catalog.generated.json a partir do catálogo da loja estática
// (public/assets/js/data.js). O servidor valida armações, cores e acessórios
// contra este arquivo — rode de novo sempre que data.js mudar:
//
//   node scripts/gen-catalog.mjs [caminho/para/data.js]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(process.argv[2] ?? `${root}/public/assets/js/data.js`);
const out = resolve(root, "src/lib/catalog.generated.json");

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(src, "utf8"), sandbox, { filename: src });
const D = sandbox.window.HB_DATA;
if (!D || !Array.isArray(D.glasses) || !Array.isArray(D.accessories)) {
  throw new Error(`HB_DATA não encontrado em ${src}`);
}

const money = (v, what) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Preço inválido para ${what}: ${v}`);
  return Math.round(n * 100) / 100;
};

const catalog = {
  prices: {
    glasses: money(D.prices?.glasses, "óculos de grau"),
    sunglasses: money(D.prices?.sunglasses, "óculos de sol"),
  },
  frames: Object.fromEntries(
    D.glasses.map((g) => [
      String(g.id),
      {
        name: String(g.name),
        sun: Boolean(g.sun),
        colors: (g.colors ?? []).map((c) => String(c.name)).filter(Boolean),
      },
    ]),
  ),
  accessories: Object.fromEntries(
    D.accessories.map((a) => [String(a.id), { name: String(a.name), price: money(a.price, a.id) }]),
  ),
};

writeFileSync(out, JSON.stringify(catalog, null, 2) + "\n");
console.log(
  `catalog.generated.json: ${Object.keys(catalog.frames).length} armações, ${Object.keys(catalog.accessories).length} acessórios (fonte: ${src})`,
);
