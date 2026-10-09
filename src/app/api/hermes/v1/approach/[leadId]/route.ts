import { validateApproach, type ApproachContext, type ApproachPayload } from "@/lib/approach";
import { authenticate, fromDb, json, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { approachSchema } from "@/lib/hermes/schemas";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/hermes/v1/approach/{leadId} — grava as variantes de mensagem.
// Antes de gravar, confere as regras contra os dados do próprio lead; se algo
// estiver fora (fato inventado, afirmação sem verificação, pressão...), responde
// 422 com a lista de erros para o Hermes reescrever. Nada é enviado a ninguém.
export async function POST(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const auth = await authenticate(request, "candidatos:criar");
  if ("response" in auth) return auth.response;
  const { leadId } = await params;
  if (!UUID.test(leadId)) return json({ status: "invalido", errors: ["lead_id inválido"] }, 422);
  const body = await parseBody(request, approachSchema);
  if ("response" in body) return body.response;

  const db = serviceClient();
  const ctx = await db.rpc("api_approach_context", { p_token: auth.tokenId, p_lead: leadId });
  if (ctx.error) return temporaryFailure();
  if (!ctx.data) return json({ status: "invalido", errors: ["lead não encontrado"] }, 422);

  const payload = body.data as ApproachPayload;
  const errors = validateApproach(ctx.data as ApproachContext, payload);
  if (errors.length) {
    // Conta a recusa: com 3 seguidas o lead sai da fila até o Marcos pedir de novo.
    await db.rpc("api_note_approach_failure", { p_token: auth.tokenId, p_lead: leadId });
    return json({ status: "invalido", errors }, 422);
  }

  const { data, error } = await db.rpc("api_save_approach", { p_token: auth.tokenId, p_lead: leadId, p: payload });
  if (error) return temporaryFailure();
  return fromDb(data);
}
