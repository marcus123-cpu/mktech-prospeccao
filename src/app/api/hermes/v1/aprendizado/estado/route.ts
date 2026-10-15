import { authenticate, fromDb, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// POST /api/hermes/v1/aprendizado/estado — o estudante do PC pergunta o que precisa estudar.
export async function POST(request: Request) {
  const auth = await authenticate(request, "mensagens:escrever");
  if ("response" in auth) return auth.response;
  const { data, error } = await serviceClient().rpc("api_apprenticeship_state");
  return error ? temporaryFailure() : fromDb(data);
}
