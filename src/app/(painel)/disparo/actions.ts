"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, dbErrorMessage } from "@/lib/auth";

type State = { error?: string; ok?: string; recovery?: "all" | "retry" | "review" };
const refresh = () => { revalidatePath("/disparo"); revalidatePath("/hermes"); };
const id = z.uuid();

/** Um clique: cria o disparo já ativo para os leads escolhidos. */
export async function startDispatch(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const scope = z.enum(["selected", "all"]).safeParse(form.get("scope"));
  const today = z.coerce.number().int().min(1).max(200).safeParse(form.get("today"));
  if (!scope.success) return { error: "Escolha quem recebe." };
  if (!today.success) return { error: "Quantos enviar hoje: de 1 a 200." };
  const leads = z.array(id).max(5000).safeParse(form.getAll("lead_ids"));
  if (!leads.success) return { error: "Lista inválida. Atualize a página e selecione os leads novamente.", recovery: "review" };
  if (scope.data === "selected" && leads.data.length === 0) return { error: "Nenhum lead foi marcado. Você pode voltar à lista ou usar todos os leads novos disponíveis.", recovery: "all" };
  const { data, error } = await supabase.rpc("admin_dispatch_start", {
    p_leads: scope.data === "selected" && leads.success ? leads.data : null,
    p_list: null,
    p_all: scope.data === "all",
    p_bot: false,
    p_today: today.data,
    p_name: null,
  });
  if (error) {
    const rejected = ["22023", "P0001"].includes(error.code);
    return {
      error: rejected ? dbErrorMessage(error) : "Não foi possível confirmar o disparo. Confira a conexão e o histórico de disparos antes de tentar novamente, para evitar duplicidade.",
      recovery: rejected ? "retry" : "review",
    };
  }
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

export async function saveSendSettings(_: State, form: FormData): Promise<State> {
 const { supabase } = await requireAdmin();
 const schema = z.object({min_delay_seconds:z.coerce.number().int().min(60).max(86400),max_delay_seconds:z.coerce.number().int().min(60).max(86400),window_start:z.coerce.number().int().min(0).max(23),window_end:z.coerce.number().int().min(1).max(24),daily_limit:z.coerce.number().int().min(1).max(200)}).refine(v=>v.max_delay_seconds>=v.min_delay_seconds && v.window_end>v.window_start,"Confira os intervalos e horários.");
 const parsed=schema.safeParse(Object.fromEntries(form));
 const days=z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7).safeParse(form.getAll("send_days"));
 if(!parsed.success || !days.success)return {error:"Informe intervalos válidos e pelo menos um dia de envio."};
 const {error}=await supabase.rpc("admin_outreach_settings",{p:{...parsed.data,send_days:days.data}});
 if(error)return {error:dbErrorMessage(error)};
 refresh();return {ok:"Configurações de envio salvas."};
}
