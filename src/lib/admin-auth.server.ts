// Autenticação do /admin: mesma mecânica da loja de origem (senha única em variável de ambiente,
// enviada em cada chamada de server function). Variável: HUBBLE_ADMIN_PASSWORD.

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function checkAdminPassword(password: string): boolean {
  const expected = process.env["HUBBLE_ADMIN_PASSWORD"];
  return !!expected && expected.length >= 8 && safeEqual(password, expected);
}

export function assertAdmin(password: string): void {
  if (!checkAdminPassword(password)) throw new Error("Não autorizado");
}
