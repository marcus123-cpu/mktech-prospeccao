import { authenticate, fromDb, json, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { compact, registerSchema } from "@/lib/hermes/schemas";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// POST /api/hermes/v1/candidates — cadastra um candidato com evidências.
// Exige o cabeçalho Idempotency-Key. Respostas: criado (201), existente (200),
// possivel_duplicado (202), invalido (422), falha_temporaria (503).
export async function POST(request: Request) {
  const auth = await authenticate(request, "candidatos:criar");
  if ("response" in auth) return auth.response;
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) {
    return json({ status: "invalido", errors: ["cabeçalho Idempotency-Key obrigatório (8 a 200 caracteres)"] }, 422);
  }
  const body = await parseBody(request, registerSchema);
  if ("response" in body) return body.response;
  const candidate = compact({
    ...body.data.candidate,
    evidences: body.data.candidate.evidences.map((e) => compact(e)),
  });
  const { data, error } = await serviceClient().rpc("api_register_candidate", {
    p_token: auth.tokenId,
    p_key: key,
    p: candidate,
    p_run: body.data.run_id ?? null,
  });
  if (error) return temporaryFailure();
  return fromDb(data);
}
