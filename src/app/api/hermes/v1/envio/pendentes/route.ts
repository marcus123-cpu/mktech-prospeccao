import { authenticate, json, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// GET /api/hermes/v1/envio/pendentes?limit=5 — leads com diagnóstico que
// precisam da mensagem do envio automático (dados, diagnóstico, evidências e
// observações do Marcos). Ler não envia nada.
export async function GET(request: Request) {
  const auth = await authenticate(request, "mensagens:escrever");
  if ("response" in auth) return auth.response;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "5");
  const { data, error } = await serviceClient().rpc("api_outreach_pending", {
    p_token: auth.tokenId,
    p_limit: Number.isFinite(limit) ? Math.trunc(limit) : 5,
  });
  if (error || !data) return temporaryFailure();
  return json(data);
}
