import { authenticate, fromDb, json, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { outreachResultSchema } from "@/lib/hermes/schemas";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/hermes/v1/envio/{id}/resultado — o enviador confirma se a etapa
// saiu (ok) ou falhou. Falha nunca é reenviada sozinha.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request, "envio:operar");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return json({ status: "invalido", errors: ["id inválido"] }, 422);
  const body = await parseBody(request, outreachResultSchema);
  if ("response" in body) return body.response;
  const { data, error } = await serviceClient().rpc("api_outreach_result", {
    p_token: auth.tokenId,
    p_id: id,
    p_step: body.data.etapa,
    p_ok: body.data.ok,
    p_error: body.data.erro ?? null,
  });
  if (error) return temporaryFailure();
  return fromDb(data);
}
