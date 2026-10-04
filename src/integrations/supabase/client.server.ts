// Server-side Supabase client with service role key - bypasses RLS.
// Use only in server functions and server routes. Never import from client code.
// Credentials come exclusively from env vars (set them in Lovable → Cloud/Secrets).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function createSupabaseAdminClient(): SupabaseClient {
  const SUPABASE_URL = process.env["SUPABASE_URL"];
  const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

let _supabaseAdmin: SupabaseClient | undefined;

/** Lazy: só falha (com mensagem clara) quando alguém realmente usa o banco. */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});

export const isSupabaseConfigured = () =>
  Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
