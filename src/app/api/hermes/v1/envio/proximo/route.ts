import { authenticate, json, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// POST /api/hermes/v1/envio/proximo — o enviador pergunta o que mandar agora.
// O servidor decide (chave global, pausa, horário, limite diário e tempo de
// segurança) e entrega no máximo uma etapa por vez: a saudação ou a mensagem
// principal, com o texto exato já salvo. Sem "enviar", não manda nada.
export async function POST(request: Request) {
  const auth = await authenticate(request, "envio:operar");
  if ("response" in auth) return auth.response;
  const { data, error } = await serviceClient().rpc("api_outreach_next", { p_token: auth.tokenId });
  if (error || !data) return temporaryFailure();
  return json(data);
}
