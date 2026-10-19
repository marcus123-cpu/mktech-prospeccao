"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, dbErrorMessage } from "@/lib/auth";

type State = { error?: string; ok?: string };
const refresh = () => { revalidatePath("/envio"); revalidatePath("/disparo"); revalidatePath("/"); };
const id = z.uuid();

type Supa = Awaited<ReturnType<typeof requireAdmin>>["supabase"];

/** Tira os leads da campanha para o Hermes não preparar a mesma mensagem de novo. */
async function dropFromCampaign(supabase: Supa, leadIds: string[]) {
  for (let i = 0; i < leadIds.length; i += 10) {
    await Promise.all(leadIds.slice(i, i + 10).map(lead => supabase.rpc("admin_campaign_remove_lead", { p_lead: lead })));
  }
}

async function run(ids: string[], action: "retry" | "cancel" | "sent"): Promise<State> {
  const { supabase } = await requireAdmin();
  if (ids.length === 0) return { error: "Nada para fazer: a lista está vazia." };
  const rows = action === "cancel" ? (await supabase.from("commercial_outbox").select("lead_id").in("id", ids)).data ?? [] : [];
  const { data, error } = await supabase.rpc("admin_outbox_action", { p_ids: ids, p_action: action });
  if (error) return { error: dbErrorMessage(error) };
  if (action === "cancel") await dropFromCampaign(supabase, [...new Set(rows.map(r => r.lead_id as string))]);
  refresh();
  const n = data ?? 0;
  if (n === 0) return { error: "Nenhuma mensagem mudou: ela já foi tratada. Atualize a página." };
  return { ok: { retry: `${n} mensagem(ns) voltaram para a fila e saem agora.`, cancel: `${n} mensagem(ns) cancelada(s).`, sent: `${n} marcada(s) como enviada(s).` }[action] };
}

/** Um botão por mensagem (reenviar, cancelar, marcar como enviada). */
export async function itemAction(_: State, form: FormData): Promise<State> {
  const parsed = z.object({ id, action: z.enum(["retry", "cancel", "sent"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Ação inválida." };
  return run([parsed.data.id], parsed.data.action);
}

/** Um botão para todas as mensagens de um grupo: sem confirmação ou toda a fila. */
export async function bulkAction(_: State, form: FormData): Promise<State> {
  const parsed = z.object({ scope: z.enum(["unknown", "queue"]), action: z.enum(["retry", "cancel", "sent"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Ação inválida." };
  const { supabase } = await requireAdmin();
  const statuses = parsed.data.scope === "unknown" ? ["desconhecido"] : ["enfileirada"];
  const { data, error } = await supabase.from("commercial_outbox").select("id").in("status", statuses).eq("simulated", false).limit(2000);
  if (error) return { error: dbErrorMessage(error) };
  return run((data ?? []).map(r => r.id as string), parsed.data.action);
}

export async function setTodayTarget(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const n = z.coerce.number().int().min(1).max(500).safeParse(form.get("today"));
  if (!n.success) return { error: "Informe um número de 1 a 500." };
  const { error } = await supabase.rpc("admin_send_today_target", { p: n.data });
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  return { ok: `Hoje podem sair ${n.data} novos contatos.` };
}

export async function resumeSending(): Promise<State> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_send_resume");
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  return { ok: "Envio ligado de novo. A próxima mensagem sai em instantes." };
}

export async function pauseSending(): Promise<State> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_campaign_pause_all");
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  return { ok: "Tudo pausado. Nada novo sai até você retomar." };
}
