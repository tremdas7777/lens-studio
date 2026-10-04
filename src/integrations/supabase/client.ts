// Browser/SSR Supabase client with the publishable (anon) key. RLS applies.
// The storefront and admin talk to the database only through server routes, so this
// client is optional; it exists for future features. Configure via env vars:
//   VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (browser, build time)
//   SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (SSR fallback)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function createSupabaseClient(): SupabaseClient {
  const env = import.meta.env as Record<string, string | undefined>;
  const SUPABASE_URL =
    env["VITE_SUPABASE_URL"] ||
    (typeof process !== "undefined" ? process.env["SUPABASE_URL"] : undefined);
  const SUPABASE_PUBLISHABLE_KEY =
    env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    (typeof process !== "undefined" ? process.env["SUPABASE_PUBLISHABLE_KEY"] : undefined);

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const message =
      "Missing Supabase environment variable(s): VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.";
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let _supabase: SupabaseClient | undefined;

// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
