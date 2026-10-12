export type Conversation = {
  id: string;
  business_name: string;
  city: string;
  stage: string;
  phone_e164: string | null;
  fit_score: number | null;
  secretary_handoff_at: string | null;
  secretary_handoff_reason: string | null;
  do_not_contact: boolean;
  last_in_at: string | null;
  last_in_body: string | null;
  last_in_media: string | null;
  last_out_at: string | null;
  pending_status: string | null;
  pending_body: string | null;
  activity_at: string;
};

export type ConversationFilter = "todas" | "minhas" | "aguardando" | "bot";

export function conversationState(c: Conversation) {
  if (c.do_not_contact || ["fechado", "sem_interesse", "desqualificado"].includes(c.stage)) return "encerrada";
  if (c.secretary_handoff_at) return "minhas";
  if (c.pending_status === "falhou") return "falhou";
  if (c.pending_status === "pronta" || c.pending_status === "enviando") return "bot";
  if (c.last_in_at && (!c.last_out_at || Date.parse(c.last_in_at) > Date.parse(c.last_out_at))) return "aguardando";
  return "respondida";
}

export const CONVERSATION_LABEL: Record<string, string> = {
  encerrada: "Encerrada", minhas: "Com você", falhou: "Falha na resposta",
  bot: "Resposta do bot na fila", aguardando: "Cliente espera resposta", respondida: "Aguardando cliente",
};
