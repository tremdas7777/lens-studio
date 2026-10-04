// Configurações privadas (tokens de integração) guardadas na tabela private_settings.
// Só o servidor (service role) lê/escreve. Gerenciadas pelo /admin.
import { isSupabaseConfigured } from "@/integrations/supabase/client.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function getPrivateSettings(keys: readonly string[]): Promise<Map<string, string>> {
  if (!isSupabaseConfigured()) return new Map();
  try {
    const { data, error } = await (
      await db()
    )
      .from("private_settings")
      .select("key,value")
      .in("key", [...keys]);
    if (error) throw error;
    return new Map(
      ((data ?? []) as { key: string; value: string | null }[])
        .filter((r) => r.value)
        .map((r) => [r.key, r.value as string]),
    );
  } catch (e) {
    console.error("getPrivateSettings failed", e);
    return new Map();
  }
}

export async function setPrivateSettings(rows: { key: string; value: string }[]): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await (
    await db()
  )
    .from("private_settings")
    .upsert(rows.map((r) => ({ ...r, updated_at: now })));
  if (error) throw new Error(error.message);
}

export async function deletePrivateSetting(key: string): Promise<void> {
  const { error } = await (await db()).from("private_settings").delete().eq("key", key);
  if (error) throw new Error(error.message);
}
