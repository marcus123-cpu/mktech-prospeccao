import { classifyReply } from "@/lib/envio/respostas";
import { authenticate, fromDb, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { outreachReplySchema } from "@/lib/hermes/schemas";
import { analisarResposta, proximoPasso, type Estado, type Papel } from "@/lib/prospeccao/conversa";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// POST /api/hermes/v1/envio/respostas — mensagem que chegou de um telefone
// abordado. Aqui ela é classificada (automática x pessoa). Só resposta de
// pessoa move o lead para "respondeu"; pedido para parar bloqueia o lead.
// Áudio conta como pessoa e avisa o Marcos para mudar o estilo da conversa.
// Depois de registrada, a resposta ganha a intenção (positiva, neutra,
// negativa, automática, esclarecimento, encaminhamento) e quem respondeu, e o
// estado comercial do lead avança (nunca volta sozinho). Nada é respondido aqui.
export async function POST(request: Request) {
  const auth = await authenticate(request, "envio:operar");
  if ("response" in auth) return auth.response;
  const body = await parseBody(request, outreachReplySchema);
  if ("response" in body) return body.response;
  const r = body.data;
  const texto = r.texto || (r.tipo === "audio" ? "[áudio]" : r.tipo === "imagem" ? "[imagem]" : "[mensagem sem texto]");
  const input = { texto, tipo: r.tipo, segundos_desde_envio: r.segundos_desde_envio, anteriores: r.anteriores };
  const c = classifyReply(input);
  const db = serviceClient();
  const { data, error } = await db.rpc("api_outreach_reply", {
    p_token: auth.tokenId,
    p: {
      phone_e164: r.telefone,
      body: texto,
      media: r.tipo,
      received_at: r.recebida_em ?? null,
      kind: c.kind,
      reason: c.reason,
      opt_out: c.optOut,
      asks_price: c.asksPrice,
    },
  });
  if (error) return temporaryFailure();
  if (data?.status === "registrada" && data.reply_id && data.lead_id) await annotate(db, auth.tokenId, data, input);
  return fromDb(data);
}

type Db = ReturnType<typeof serviceClient>;

/** Grava intenção, papel e próximo estado. Falha aqui não perde a resposta. */
async function annotate(db: Db, token: string, reg: { reply_id: string; lead_id: string }, input: Parameters<typeof classifyReply>[0]) {
  try {
    const [lead, msg] = await Promise.all([
      db.from("leads").select("conversation_state, contact_role, video_offered_at, video_sent_at").eq("id", reg.lead_id).maybeSingle(),
      db.from("outreach_messages").select("strategy, sent_at").eq("lead_id", reg.lead_id).neq("status", "cancelada").maybeSingle(),
    ]);
    if (lead.error || !lead.data) return;
    const l = lead.data;
    // A (posso mostrar?) e C (posso enviar o vídeo?) já ofereceram a demonstração.
    const oferecido = !!l.video_offered_at || (!!msg.data?.sent_at && ["A", "C"].includes(msg.data.strategy ?? ""));
    const a = analisarResposta({ ...input, oferecido });
    const p = proximoPasso(
      {
        estado: l.conversation_state as Estado | null,
        papel: l.contact_role as Papel | null,
        videoOferecidoEm: oferecido ? (l.video_offered_at ?? msg.data?.sent_at ?? null) : null,
        videoEnviadoEm: l.video_sent_at,
      },
      a,
    );
    await db.rpc("api_reply_annotate", {
      p_token: token,
      p_reply: reg.reply_id,
      p: {
        intencao: a.intencao,
        papel: a.papel,
        estado: p.estado,
        interesse: p.registrar.interesse ?? null,
        video: p.registrar.videoAutorizado ? "autorizado" : null,
        motivo: a.motivo,
      },
    });
  } catch {
    // A resposta já está registrada; a classificação comercial fica para o Marcos.
  }
}
