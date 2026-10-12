import { authenticate, fromDb, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// GET /api/hermes/v1/pedidos — o Marcos pediu uma busca no painel? Só olha:
// quem pega o pedido é o start-run da rotina "pedido-painel".
export async function GET(request: Request) {
  const auth = await authenticate(request, "execucoes:registrar");
  if ("response" in auth) return auth.response;
  const { data, error } = await serviceClient().rpc("api_search_request_peek", { p_token: auth.tokenId });
  if (error) return temporaryFailure();
  return fromDb(data);
}
