"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, dbErrorMessage } from "@/lib/auth";

type State = { error?: string; ok?: string };
const refresh = () => { revalidatePath("/campanhas"); revalidatePath("/comercial"); revalidatePath("/envio"); revalidatePath("/conversas"); };
const id = z.uuid();

export async function createCampaign(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const parsed = z.object({ name: z.string().trim().min(1).max(80), notes: z.string().trim().max(500).optional() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Informe um nome de até 80 caracteres." };
  const { error } = await supabase.rpc("admin_campaign_create", { p_name: parsed.data.name, p_notes: parsed.data.notes || null });
  if (error) return { error: dbErrorMessage(error) };
  refresh(); return { ok: "Campanha criada em modo simulação." };
}

export async function addCampaignLeads(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const campaign = id.safeParse(form.get("campaign_id"));
  const leads = z.array(id).min(1).max(200).safeParse(form.getAll("lead_ids"));
  if (!campaign.success || !leads.success) return { error: "Selecione de 1 a 200 leads." };
  const { data, error } = await supabase.rpc("admin_campaign_add_leads", { p_campaign: campaign.data, p_leads: leads.data });
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  const rejected = (data?.rejected ?? []) as { reason: string }[];
  const reasons = [...new Set(rejected.map((r) => r.reason))].join(" ");
  return rejected.length ? { ok: `${data.added} adicionado(s). ${data.rejected_total ?? rejected.length} recusado(s): ${reasons}` } : { ok: `${data.added} lead(s) adicionado(s).` };
}

export async function removeCampaignLead(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const lead = id.safeParse(form.get("lead_id"));
  if (!lead.success) return { error: "Lead inválido." };
  const { error } = await supabase.rpc("admin_campaign_remove_lead", { p_lead: lead.data });
  if (error) return { error: dbErrorMessage(error) };
  refresh(); return { ok: "Lead removido." };
}

export async function setCampaignMode(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const parsed = z.object({ campaign_id: id, mode: z.enum(["simulacao", "autonomo"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Modo inválido." };
  const { error } = await supabase.rpc("admin_campaign_set_mode", { p_campaign: parsed.data.campaign_id, p_mode: parsed.data.mode });
  if (error) return { error: dbErrorMessage(error) };
  refresh(); return { ok: parsed.data.mode === "autonomo" ? "Modo autônomo liberado. A simulação foi apagada; ative a campanha quando quiser." : "Campanha em modo simulação." };
}

const LABEL = { activate: "Campanha ativada.", resume: "Campanha retomada.", pause: "Campanha pausada. Nada novo sai.", end: "Campanha encerrada." } as const;
export async function campaignAction(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const parsed = z.object({ campaign_id: id, action: z.enum(["activate", "resume", "pause", "end"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Ação inválida." };
  const { error } = await supabase.rpc("admin_campaign_action", { p_campaign: parsed.data.campaign_id, p_action: parsed.data.action });
  if (error) return { error: dbErrorMessage(error) };
  refresh(); return { ok: LABEL[parsed.data.action] };
}

export async function pauseEverything(): Promise<State> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("admin_campaign_pause_all");
  if (error) return { error: dbErrorMessage(error) };
  refresh(); return { ok: `Pausa imediata: ${data ?? 0} campanha(s) pausada(s) e envio global parado.` };
}

export async function simulateReply(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const parsed = z.object({ lead_id: id, body: z.string().trim().min(1).max(1000) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Escreva a resposta do cliente simulado." };
  const { error } = await supabase.rpc("admin_campaign_simulate_reply", { p_lead: parsed.data.lead_id, p_body: parsed.data.body });
  if (error) return { error: dbErrorMessage(error) };
  refresh(); return { ok: "Resposta simulada enviada ao Hermes; atualize em alguns segundos." };
}

const addedMessage = (data: { added?: number; rejected_total?: number; rejected?: { reason: string }[] }) => {
  const reasons = [...new Set((data?.rejected ?? []).map((r) => r.reason))].join(" ");
  return data?.rejected_total ? `${data.added ?? 0} adicionado(s). ${data.rejected_total} recusado(s): ${reasons}` : `${data?.added ?? 0} lead(s) adicionado(s).`;
};

export async function addCampaignList(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const parsed = z.object({ campaign_id: id, list_id: id }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Escolha a lista." };
  const { data, error } = await supabase.rpc("admin_campaign_add_list", { p_campaign: parsed.data.campaign_id, p_list: parsed.data.list_id });
  if (error) return { error: dbErrorMessage(error) };
  refresh(); return { ok: addedMessage(data) };
}

export async function addCampaignEligible(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const parsed = z.object({ campaign_id: id }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Campanha inválida." };
  const { data, error } = await supabase.rpc("admin_campaign_add_eligible", { p_campaign: parsed.data.campaign_id });
  if (error) return { error: dbErrorMessage(error) };
  refresh(); return { ok: addedMessage(data) };
}
