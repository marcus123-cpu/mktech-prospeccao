import { authenticate, json, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// POST /api/hermes/v1/envio/manual/proximo — o enviador pega a próxima resposta
// escrita pelo Marcos no painel (sem janela de horário: foi uma ação humana).
export async function POST(request: Request) {
  const auth = await authenticate(request, "envio:operar");
  if ("response" in auth) return auth.response;
  const { data, error } = await serviceClient().rpc("api_manual_next", { p_token: auth.tokenId });
  if (error || !data) return temporaryFailure();
  if (data.status === "enviar" && data.media === "audio") {
    const { data: signed, error: signError } = await serviceClient().storage.from("chat-audio").createSignedUrl(data.audio_path, 120);
    if (signError || !signed) {
      await serviceClient().rpc("api_manual_result", { p_token: auth.tokenId, p_id: data.id, p_ok: false, p_provider: null, p_error: "Não foi possível abrir o arquivo de áudio" });
      return temporaryFailure();
    }
    return json({ ...data, audio_url: signed.signedUrl });
  }
  return json(data);
}
