import { z } from "zod";
import { authenticate, fromDb, json, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({
  ok: z.boolean(),
  provider_id: z.string().max(200).nullish(),
  erro: z.string().max(500).nullish(),
});

// POST /api/hermes/v1/envio/manual/{id}/resultado — confirma se a resposta saiu.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request, "envio:operar");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!UUID.test(id)) return json({ status: "invalido", errors: ["id inválido"] }, 422);
  const body = await parseBody(request, schema);
  if ("response" in body) return body.response;
  const { data, error } = await serviceClient().rpc("api_manual_result", {
    p_token: auth.tokenId, p_id: id, p_ok: body.data.ok, p_provider: body.data.provider_id ?? null, p_error: body.data.erro ?? null,
  });
  if (error) return temporaryFailure();
  return fromDb(data);
}
