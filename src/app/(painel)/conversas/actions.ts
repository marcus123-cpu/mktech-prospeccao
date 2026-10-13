"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { generateReplyDraft, type DraftContext, type ReplyDraft } from "@/lib/conversation-draft";

export type ConversationState = { error?: string; ok?: string };
const memorySchema = z.object({
  lead_id: z.uuid(), summary: z.string().trim().max(2000), facts: z.string().trim().max(3000),
  objections: z.string().trim().max(2000), next_action: z.string().trim().max(1000),
});

function refresh(id: string) {
  revalidatePath("/comercial");
  revalidatePath("/conversas");
  revalidatePath("/funil");
  revalidatePath("/envio");
  revalidatePath(`/leads/${id}`);
}

export async function saveMemory(_: ConversationState, form: FormData): Promise<ConversationState> {
  const { supabase } = await requireAdmin();
  const parsed = memorySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revise os campos e o tamanho dos textos." };
  const { lead_id, ...memory } = parsed.data;
  const { error } = await supabase.rpc("admin_save_conversation_memory", { p_lead: lead_id, p: memory });
  if (error) return { error: dbErrorMessage(error) };
  refresh(lead_id);
  return { ok: "Memória salva. O bot usará essas informações na próxima resposta." };
}

export async function setConversationOwner(_: ConversationState, form: FormData): Promise<ConversationState> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("lead_id"));
  const owner = z.enum(["marcos", "secretario"]).safeParse(form.get("owner"));
  if (!id.success || !owner.success) return { error: "Dados inválidos." };
  const { error } = await supabase.rpc(owner.data === "marcos" ? "admin_take_conversation" : "admin_secretary_return", { p_lead: id.data });
  if (error) return { error: dbErrorMessage(error) };
  refresh(id.data);
  return { ok: owner.data === "marcos" ? "Você assumiu o atendimento. Respostas do bot na fila foram canceladas." : "Conversa devolvida. O bot respeita a chave e o horário de atendimento." };
}

export async function suggestReply(leadId: string): Promise<{ draft: ReplyDraft } | { error: string }> {
  const { supabase } = await requireAdmin();
  const parsed = z.uuid().safeParse(leadId);
  if (!parsed.success) return { error: "Conversa inválida." };
  const [lead, history, memory, diagnosis] = await Promise.all([
    supabase.from("conversation_inbox").select("business_name, city").eq("id", parsed.data).maybeSingle(),
    supabase.from("conversation_timeline").select("direction, source, body, media").eq("lead_id", parsed.data).order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(20),
    supabase.from("lead_conversation_memory").select("summary, facts, objections, next_action").eq("lead_id", parsed.data).maybeSingle(),
    supabase.from("lead_diagnoses").select("summary, pains, offer").eq("lead_id", parsed.data).order("created_at", { ascending: false }).limit(1),
  ]);
  if (lead.error || history.error || memory.error || diagnosis.error || !lead.data) return { error: "Não foi possível ler o contexto desta conversa." };
  const messages = [...(history.data ?? [])].reverse();
  const latest = messages.at(-1);
  if (!latest || latest.direction !== "entrada") return { error: "Aguarde uma nova mensagem do cliente para sugerir uma resposta." };
  if (!latest.body?.trim()) return { error: "A última mensagem não tem texto. Confira o áudio ou a imagem no WhatsApp antes de responder." };
  const context: DraftContext = {
    business_name: lead.data.business_name, city: lead.data.city,
    memory: memory.data, diagnosis: diagnosis.data?.[0] ?? null, messages,
  };
  try { return { draft: await generateReplyDraft(context) }; }
  catch { return { error: "Não foi possível gerar a sugestão agora. Tente novamente." }; }
}
