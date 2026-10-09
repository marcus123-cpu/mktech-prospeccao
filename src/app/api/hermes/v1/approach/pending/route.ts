import { authenticate, json, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// GET /api/hermes/v1/approach/pending?limit=5 — leads que precisam de
// rascunhos de abordagem, com o contexto permitido para escrever.
export async function GET(request: Request) {
  const auth = await authenticate(request, "candidatos:criar");
  if ("response" in auth) return auth.response;
  const raw = Number(new URL(request.url).searchParams.get("limit") ?? "5");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 20) : 5;
  const { data, error } = await serviceClient().rpc("api_pending_approach", { p_token: auth.tokenId, p_limit: limit });
  if (error || !data) return temporaryFailure();
  return json(data);
}
