import { validateOutreach, type LeadContext, type OutreachPayload } from "@/lib/envio/mensagem";
import { authenticate, fromDb, json, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { outreachSchema } from "@/lib/hermes/schemas";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/hermes/v1/envio/mensagens/{leadId} — grava a mensagem do envio
// automático. Antes, confere as regras contra os dados do próprio lead. Fora
// das regras (texto técnico, fato inventado, saudação junto...) responde 422,
// conta a recusa no lead e nada entra na fila. Com 3 recusas o lead sai da fila
// e aparece no painel para o Marcos olhar.
export async function POST(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const auth = await authenticate(request, "mensagens:escrever");
  if ("response" in auth) return auth.response;
  const { leadId } = await params;
  if (!UUID.test(leadId)) return json({ status: "invalido", errors: ["lead_id inválido"] }, 422);

  const db = serviceClient();
  const body = await parseBody(request, outreachSchema);
  if ("response" in body) {
    if (body.response.status === 422) {
      await db.rpc("api_outreach_note_failure", { p_token: auth.tokenId, p_lead: leadId, p_errors: "formato inválido" });
    }
    return body.response;
  }

  const ctx = await db.rpc("api_outreach_context", { p_token: auth.tokenId, p_lead: leadId });
  if (ctx.error) return temporaryFailure();
  if (!ctx.data) return json({ status: "invalido", errors: ["lead não encontrado"] }, 422);

  const payload = body.data as OutreachPayload;
  const errors = validateOutreach(ctx.data as LeadContext, payload);
  if (errors.length) {
    const noted = await db.rpc("api_outreach_note_failure", {
      p_token: auth.tokenId,
      p_lead: leadId,
      p_errors: errors.join(" | "),
    });
    return json({ status: "invalido", errors, ...(noted.data ? { lead: noted.data } : {}) }, 422);
  }

  const { data, error } = await db.rpc("api_outreach_save", { p_token: auth.tokenId, p_lead: leadId, p: payload });
  if (error) return temporaryFailure();
  return fromDb(data);
}
