import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";

// Cliente com a chave service_role. Usado SOMENTE pelas rotas /api/hermes,
// que chamam apenas as funções api_* do banco. Nunca importar em componentes
// de cliente: o pacote "server-only" quebra o build se isso acontecer.
let cached: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada no servidor");
  }
  cached ??= createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
