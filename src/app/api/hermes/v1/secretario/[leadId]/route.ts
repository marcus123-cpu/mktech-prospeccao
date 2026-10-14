import { validateSecretaryReply } from "@/lib/envio/mensagem";
import { authenticate, fromDb, json, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { secretaryReplySchema } from "@/lib/hermes/schemas";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/hermes/v1/secretario/{leadId} — o secretário grava a resposta da
// conversa e/ou passa a conversa para o Marcos. Resposta fora das regras
// (texto técnico, link, valor, IA...) volta 422 e nada entra na fila.
// `comercial` (opcional) registra quem respondeu, o estado da conversa, o
// interesse e o vídeo oferecido/autorizado no histórico comercial do lead.
export async function POST(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const auth = await authenticate(request, "mensagens:escrever");
  if ("response" in auth) return auth.response;
  const { leadId } = await params;
  if (!UUID.test(leadId)) return json({ status: "invalido", errors: ["lead_id inválido"] }, 422);
  const body = await parseBody(request, secretaryReplySchema);
  if ("response" in body) return body.response;

  if (body.data.resposta) {
    const errors = validateSecretaryReply(body.data.resposta);
    if (errors.length) return json({ status: "invalido", errors }, 422);
  }
  const { comercial, ...reply } = body.data;
  const db = serviceClient();
  const { data, error } = await db.rpc("api_secretary_save", {
    p_token: auth.tokenId,
    p_lead: leadId,
    p: reply,
  });
  if (error) return temporaryFailure();
  if (comercial && data?.status !== "invalido") {
    const fields = Object.fromEntries(Object.entries(comercial).filter(([, v]) => v !== null && v !== undefined));
    if (Object.keys(fields).length) {
      // A resposta já foi gravada: falha aqui não pede para o Hermes repetir.
      await db.rpc("api_commercial_update", { p_token: auth.tokenId, p_lead: leadId, p: fields });
    }
  }
  return fromDb(data);
}
