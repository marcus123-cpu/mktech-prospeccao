import { authenticate, fromDb, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { startRunSchema } from "@/lib/hermes/schemas";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// POST /api/hermes/v1/runs — registra o início de uma execução.
// 409 (ja_em_andamento) quando a mesma rotina já está rodando.
export async function POST(request: Request) {
  const auth = await authenticate(request, "execucoes:registrar");
  if ("response" in auth) return auth.response;
  const body = await parseBody(request, startRunSchema);
  if ("response" in body) return body.response;
  const { data, error } = await serviceClient().rpc("api_start_run", {
    p_token: auth.tokenId,
    p_routine: body.data.routine,
    p_config: body.data.config ?? {},
  });
  if (error) return temporaryFailure();
  return fromDb(data);
}
