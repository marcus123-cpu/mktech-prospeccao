import { validateOutreach, type LeadContext } from "@/lib/envio/mensagem";
import { authenticate, fromDb, json, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { readingSchema } from "@/lib/hermes/schemas";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/hermes/v1/envio/leitura/{messageId} — grava o texto do estilo
// "lendo a resposta", escrito depois que a pessoa respondeu. Vale a mesma
// regra da mensagem preparada (fatos do lead, sem site, sem preço, uma pergunta
// no final), menos a proibição de começar com "bom dia": aqui é uma resposta.
export async function POST(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const auth = await authenticate(request, "mensagens:escrever");
  if ("response" in auth) return auth.response;
  const { messageId } = await params;
  if (!UUID.test(messageId)) return json({ status: "invalido", errors: ["message_id inválido"] }, 422);
  const body = await parseBody(request, readingSchema);
  if ("response" in body) return body.response;

  const db = serviceClient();
  const msg = await db
    .from("outreach_messages")
    .select("lead_id, compliment, pain, improvement")
    .eq("id", messageId)
    .maybeSingle();
  if (msg.error) return temporaryFailure();
  if (!msg.data) return json({ status: "invalido", errors: ["mensagem não encontrada"] }, 422);

  const ctx = await db.rpc("api_outreach_context", { p_token: auth.tokenId, p_lead: msg.data.lead_id });
  if (ctx.error) return temporaryFailure();
  if (!ctx.data) return json({ status: "invalido", errors: ["lead não encontrado"] }, 422);

  const errors = validateOutreach(
    ctx.data as LeadContext,
    {
      elogio: msg.data.compliment ?? "",
      dor: msg.data.pain ?? "",
      melhoria: msg.data.improvement ?? "",
      mensagem: body.data.mensagem,
    },
    { replying: true },
  );
  if (errors.length) return json({ status: "invalido", errors }, 422);

  const { data, error } = await db.rpc("api_outreach_reading_save", {
    p_token: auth.tokenId,
    p_message: messageId,
    p_text: body.data.mensagem.trim(),
  });
  if (error) return temporaryFailure();
  return fromDb(data);
}
