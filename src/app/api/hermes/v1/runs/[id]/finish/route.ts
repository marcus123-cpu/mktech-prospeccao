import { authenticate, fromDb, json, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { finishRunSchema } from "@/lib/hermes/schemas";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// POST /api/hermes/v1/runs/{id}/finish — registra resultado e término.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request, "execucoes:registrar");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ status: "invalido", errors: ["id inválido"] }, 422);
  const body = await parseBody(request, finishRunSchema);
  if ("response" in body) return body.response;
  const { data, error } = await serviceClient().rpc("api_finish_run", {
    p_token: auth.tokenId,
    p_run: id,
    p: body.data,
  });
  if (error) return temporaryFailure();
  return fromDb(data);
}
