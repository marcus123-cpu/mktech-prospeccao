import { authenticate, fromDb, json, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { compact, registerSchema } from "@/lib/hermes/schemas";
import { serviceClient } from "@/lib/supabase/admin";
import { scoreResearch } from "@/lib/commercial/engine";
import { registrationFocus } from "@/lib/commercial/research-focus";

export const dynamic = "force-dynamic";

/** O motivo do descarte alimenta o relatório da pesquisa; falhar em gravá-lo nunca muda a resposta ao Hermes. */
async function recordDiscard(runId: string, name: string, code: string, reason: string) {
  try {
    await serviceClient().from("hermes_run_discards").insert({ run_id: runId, business_name: name.slice(0, 200), reason_code: code, reason: reason.slice(0, 500) });
  } catch {
    /* relatório fica sem esta linha */
  }
}

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
  // Critério obrigatório: sem site confirmado. Vale para qualquer cadastro feito pelo Hermes.
  const focus = registrationFocus(body.data.candidate);
  if (!focus.accepted) {
    if (body.data.run_id) await recordDiscard(body.data.run_id, body.data.candidate.business_name, focus.code, focus.reason);
    return json({ status: "invalido", errors: [focus.reason] }, 422);
  }
  const candidate = compact({
    ...body.data.candidate,
    evidences: body.data.candidate.evidences.map((e) => compact(e)),
  });
  const { data, error } = await serviceClient().rpc("api_register_candidate", {
    p_token: auth.tokenId,
    p_key: key,
    p: { ...candidate, commercial_score: scoreResearch(body.data.candidate, new Date().toISOString()) },
    p_run: body.data.run_id ?? null,
  });
  if (error) return temporaryFailure();
  if (body.data.run_id && data?.status === "invalido") {
    const reason = (Array.isArray(data.errors) ? data.errors.join("; ") : "dados inválidos").slice(0, 500);
    await recordDiscard(body.data.run_id, body.data.candidate.business_name, "dados_invalidos", reason);
  }
  return fromDb(data);
}
