import { authenticate, fromDb, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { checkSchema, compact } from "@/lib/hermes/schemas";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// POST /api/hermes/v1/duplicates/check — consulta sem gravar nada.
export async function POST(request: Request) {
  const auth = await authenticate(request, "duplicados:ler");
  if ("response" in auth) return auth.response;
  const body = await parseBody(request, checkSchema);
  if ("response" in body) return body.response;
  const { data, error } = await serviceClient().rpc("api_check_duplicates", {
    p_token: auth.tokenId,
    p: compact(body.data),
  });
  if (error) return temporaryFailure();
  return fromDb(data);
}
