import { authenticate, json, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// GET /api/hermes/v1/identifiers — identificadores já cadastrados (sem dados comerciais).
export async function GET(request: Request) {
  const auth = await authenticate(request, "duplicados:ler");
  if ("response" in auth) return auth.response;
  const { data, error } = await serviceClient().rpc("api_existing_identifiers", { p_token: auth.tokenId });
  if (error || !data) return temporaryFailure();
  return json({ status: "ok", identifiers: data });
}
