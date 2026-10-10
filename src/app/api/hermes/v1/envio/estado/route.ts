import { authenticate, json, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// GET /api/hermes/v1/envio/estado — chave, pausa e tamanho da fila. Não reserva nada.
export async function GET(request: Request) {
  const auth = await authenticate(request, "envio:operar");
  if ("response" in auth) return auth.response;
  const { data, error } = await serviceClient().rpc("api_outreach_state", { p_token: auth.tokenId });
  if (error || !data) return temporaryFailure();
  return json(data);
}
