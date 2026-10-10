import { authenticate, json, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// GET /api/hermes/v1/settings — meta diária, cidades, nichos e limites da execução.
export async function GET(request: Request) {
  const auth = await authenticate(request, "config:ler");
  if ("response" in auth) return auth.response;
  const { data, error } = await serviceClient().rpc("api_get_settings", { p_token: auth.tokenId });
  if (error || !data) return temporaryFailure();
  return json({ status: "ok", settings: data });
}

