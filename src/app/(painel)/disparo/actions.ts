"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, dbErrorMessage } from "@/lib/auth";

type State = { error?: string; ok?: string };
const refresh = () => { revalidatePath("/disparo"); revalidatePath("/campanhas"); revalidatePath("/hermes"); revalidatePath("/kanban"); };
const id = z.uuid();

/** Um clique: cria o disparo já ativo para os leads escolhidos. */
export async function startDispatch(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const scope = z.enum(["selected", "list", "all"]).safeParse(form.get("scope"));
  const how = z.enum(["normal", "bot"]).safeParse(form.get("how"));
  const today = z.coerce.number().int().min(1).max(200).safeParse(form.get("today"));
  if (!scope.success || !how.success) return { error: "Escolha quem recebe e como enviar." };
  if (!today.success) return { error: "Quantos enviar hoje: de 1 a 200." };
  const leads = z.array(id).max(5000).safeParse(form.getAll("lead_ids"));
  const list = id.safeParse(form.get("list_id"));
  if (scope.data === "selected" && (!leads.success || leads.data.length === 0)) return { error: "Marque pelo menos um lead na lista." };
  if (scope.data === "list" && !list.success) return { error: "Escolha uma das suas listas." };
  const { data, error } = await supabase.rpc("admin_dispatch_start", {
    p_leads: scope.data === "selected" && leads.success ? leads.data : null,
    p_list: scope.data === "list" && list.success ? list.data : null,
    p_all: scope.data === "all",
    p_bot: how.data === "bot",
    p_today: today.data,
    p_name: null,
  });
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  const skipped = data?.rejected_total ? ` ${data.rejected_total} ficaram de fora (telefone fixo, já contatado, bloqueado ou repetido).` : "";
  return { ok: `Disparo iniciado para ${data?.added ?? 0} lead(s). Os envios saem aos poucos, no horário e no limite configurados.${skipped}` };
}

export async function dispatchAction(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const parsed = z.object({ campaign_id: id, action: z.enum(["pause", "resume", "end"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Ação inválida." };
  const { error } = await supabase.rpc("admin_campaign_action", { p_campaign: parsed.data.campaign_id, p_action: parsed.data.action });
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  return { ok: { pause: "Disparo pausado.", resume: "Disparo retomado.", end: "Disparo cancelado." }[parsed.data.action] };
}

export async function stopAll(): Promise<State> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("admin_campaign_pause_all");
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  return { ok: `Tudo pausado (${data ?? 0} disparo(s)). Nada novo sai.` };
}
