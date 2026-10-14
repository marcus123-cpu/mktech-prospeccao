"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, dbErrorMessage } from "@/lib/auth";
import { ROLES, STAGES } from "@/lib/commercial/engine";

type State = { error?: string; ok?: string };
const refresh = () => { revalidatePath("/comercial"); revalidatePath("/conversas"); revalidatePath("/envio"); };
export async function activateCommercial(_:State):Promise<State> {
  const {supabase}=await requireAdmin();
  const {error}=await supabase.rpc("admin_commercial_activate");
  if(error)return {error:dbErrorMessage(error)};
  refresh();revalidatePath("/envio");return {ok:"Hermes ativado com limite inicial conservador."};
}
export async function saveCommercialSettings(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const max = z.coerce.number().int().min(1).max(50).safeParse(form.get("max_messages"));
  const phones = String(form.get("test_phones") ?? "").split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
  if (!max.success || phones.length > 50 || phones.some((p) => !/^\+?[\d ()-]{10,25}$/.test(p))) return { error: "Revise limite e telefones de teste." };
  const strategies = form.getAll("allowed_strategies");
  if (!z.array(z.enum(["A","B","C"])).min(1).safeParse(strategies).success) return { error: "Selecione pelo menos uma estratégia." };
  const { error } = await supabase.rpc("admin_commercial_settings", { p: {
    engine_version:form.get('engine_version')==='v6'?'v6':'v4',new_contacts_enabled:form.get('new_contacts_enabled')==='on',
    enabled: form.get("enabled") === "on", channel_authorized: form.get("channel_authorized") === "on",
    test_mode: form.get("test_mode") === "on", video_configured: form.get("video_configured") === "on",
    experiment_enabled: form.get("experiment_enabled") === "on", test_phones: phones, allowed_strategies: strategies, max_messages: max.data,
    objection_recovery_enabled: form.get("objection_recovery_enabled") === "on",
  } });
  if (error) return { error: dbErrorMessage(error) };
  refresh(); return { ok: "Configuração salva. O envio também respeita a chave geral e os horários." };
}
export async function pauseCommercial(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const pause = form.get("pause") !== "false";
  const { error } = await supabase.rpc("admin_outreach_settings", { p: { paused: pause } });
  if (error) return { error: dbErrorMessage(error) };
  refresh(); revalidatePath("/envio"); return { ok: pause ? "Operação pausada." : "Operação retomada conforme as configurações." };
}
export async function pauseNewContacts(_:State,form:FormData):Promise<State>{
 const {supabase}=await requireAdmin();
 const enabled=form.get('enabled')==='true';
 const {error}=await supabase.rpc('admin_commercial_settings',{p:{new_contacts_enabled:enabled}});
 if(error)return {error:dbErrorMessage(error)};
 refresh();return {ok:enabled?'Novas abordagens habilitadas.':'Novas abordagens pausadas; atendimento mantido.'};
}
export async function saveCommercialLead(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const parsed = z.object({ lead_id: z.uuid(), stage: z.enum(STAGES), role: z.enum(ROLES), role_evidence: z.string().max(1000), eligibility_reason: z.string().max(1000) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revise os dados do lead." };
  const { lead_id, ...p } = parsed.data;
  const { error } = await supabase.rpc("admin_commercial_lead", { p_lead: lead_id, p: { ...p, eligible: form.get("eligible") === "on", reason: "Correção pelo painel comercial" } });
  if (error) return { error: dbErrorMessage(error) };
  refresh(); return { ok: "Lead atualizado; respostas pendentes foram canceladas para reler o contexto." };
}
export async function addProduct(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const parsed = z.object({ name: z.string().trim().min(1).max(100), scope: z.enum(["landing_page_whatsapp","site_institucional","agendamento"]), price: z.coerce.number().positive().max(999999), conditions: z.string().trim().min(1).max(250) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revise produto, preço e condições." };
  const delivery = String(form.get("delivery_days") ?? "").trim();
  const id = form.get("id");
  if (id && !z.uuid().safeParse(id).success) return { error: "Produto inválido." };
  if (delivery && !z.coerce.number().int().min(1).max(365).safeParse(delivery).success) return { error: "Prazo deve ser de 1 a 365 dias ou ficar vazio." };
  const { error } = await supabase.rpc("admin_commercial_product", { p: { ...parsed.data, ...(id ? { id } : {}), delivery_days: delivery || null, approved: form.get("approved") === "on" } });
  if (error) return { error: dbErrorMessage(error) };
  refresh(); return { ok: "Produto cadastrado." };
}
