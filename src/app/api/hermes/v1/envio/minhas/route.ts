import { authenticate, fromDb, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { outreachOutboundSchema } from "@/lib/hermes/schemas";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// POST /api/hermes/v1/envio/minhas — o Marcos escreveu à mão para um telefone
// abordado. Só o horário é guardado (para saber quem falou por último e quando
// um lembrete pode sair); o texto nunca chega aqui.
export async function POST(request: Request) {
  const auth = await authenticate(request, "envio:operar");
  if ("response" in auth) return auth.response;
  const body = await parseBody(request, outreachOutboundSchema);
  if ("response" in body) return body.response;
  const { data, error } = await serviceClient().rpc("api_outreach_outbound", {
    p_token: auth.tokenId,
    p: { phone_e164: body.data.telefone, sent_at: body.data.enviada_em ?? null },
  });
  if (error) return temporaryFailure();
  return fromDb(data);
}
