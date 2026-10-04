// Acesso ao banco pelo servidor (service role). Envolve o cliente gerado pela Lovable
// sem tipagem estrita, pois o código usa os tipos de src/lib/db-types.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin as generated } from "@/integrations/supabase/client.server";

export const supabaseAdmin = generated as unknown as SupabaseClient;

export const isSupabaseConfigured = () =>
  Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
