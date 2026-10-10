import { classifyReply } from "@/lib/envio/respostas";
import { authenticate, fromDb, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { outreachReplySchema } from "@/lib/hermes/schemas";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// POST /api/hermes/v1/envio/respostas — mensagem que chegou de um telefone
// abordado. Aqui ela é classificada (automática x pessoa). Só resposta de
// pessoa move o lead para "respondeu"; pedido para parar bloqueia o lead.
// Ninguém responde ao cliente automaticamente: o Marcos assume a conversa.
export async function POST(request: Request) {
  const auth = await authenticate(request, "envio:operar");
  if ("response" in auth) return auth.response;
  const body = await parseBody(request, outreachReplySchema);
  if ("response" in body) return body.response;
  const r = body.data;
  const c = classifyReply({ texto: r.texto, segundos_desde_envio: r.segundos_desde_envio, anteriores: r.anteriores });
  const { data, error } = await serviceClient().rpc("api_outreach_reply", {
    p_token: auth.tokenId,
    p: {
      phone_e164: r.telefone,
      body: r.texto,
      received_at: r.recebida_em ?? null,
      kind: c.kind,
      reason: c.reason,
      opt_out: c.optOut,
    },
  });
  if (error) return temporaryFailure();
  return fromDb(data);
}
