"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";

export type EnvioState = { error?: string; ok?: string; token?: string };

const settingsSchema = z
  .object({
    min_delay_minutes: z.coerce.number().min(1).max(1440),
    max_delay_minutes: z.coerce.number().min(1).max(1440),
    greeting_gap_min_seconds: z.coerce.number().int().min(10).max(1800),
    greeting_gap_max_seconds: z.coerce.number().int().min(10).max(1800),
    daily_limit: z.coerce.number().int().min(1).max(200),
    window_start: z.coerce.number().int().min(0).max(23),
    window_end: z.coerce.number().int().min(1).max(24),
    reply_window_start: z.coerce.number().int().min(0).max(23),
    reply_window_end: z.coerce.number().int().min(1).max(24),
    min_fit_score: z.coerce.number().int().min(0).max(100),
  })
  .refine((v) => v.max_delay_minutes >= v.min_delay_minutes, "A espera máxima precisa ser maior ou igual à mínima.")
  .refine((v) => v.greeting_gap_max_seconds >= v.greeting_gap_min_seconds, "O intervalo máximo depois da saudação precisa ser maior ou igual ao mínimo.")
  .refine((v) => v.window_end > v.window_start, "O fim da prospecção precisa ser depois do início.")
  .refine((v) => v.reply_window_end > v.reply_window_start, "O fim do atendimento precisa ser depois do início.");

function done(ok: string): EnvioState {
  revalidatePath("/envio");
  revalidatePath("/");
  return { ok };
}

export async function setTodayTarget(_: EnvioState, form: FormData): Promise<EnvioState> {
  const { supabase } = await requireAdmin();
  const target = z.string().regex(/^(0|[1-9]\d{0,2})$/).transform(Number).refine((n) => n <= 200)
    .safeParse(form.get("target"));
  if (!target.success) return { error: "Informe de 0 a 200 novos contatos para hoje." };
  const { error } = await supabase.rpc("admin_outreach_today_target", { p_target: target.data });
  if (error) return { error: dbErrorMessage(error) };
  return done(target.data === 0 ? "Novos contatos parados pelo resto do dia." : `Meta de hoje atualizada para ${target.data} novos contatos.`);
}

export async function saveOutreachSettings(_: EnvioState, form: FormData): Promise<EnvioState> {
  const { supabase } = await requireAdmin();
  const parsed = settingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revise os valores." };
  const days = form.getAll("send_days").map(Number).filter((d) => d >= 1 && d <= 7);
  if (!days.length) return { error: "Escolha pelo menos um dia da semana." };
  const v = parsed.data;
  const { error } = await supabase.rpc("admin_outreach_settings", {
    p: {
      min_delay_seconds: Math.round(v.min_delay_minutes * 60),
      max_delay_seconds: Math.round(v.max_delay_minutes * 60),
      greeting_gap_min_seconds: v.greeting_gap_min_seconds,
      greeting_gap_max_seconds: v.greeting_gap_max_seconds,
      daily_limit: v.daily_limit,
      window_start: v.window_start,
      window_end: v.window_end,
      reply_window_start: v.reply_window_start,
      reply_window_end: v.reply_window_end,
      min_fit_score: v.min_fit_score,
      send_days: days,
    },
  });
  if (error) return { error: dbErrorMessage(error) };
  return done("Configurações do envio salvas.");
}

export async function setEnabled(_: EnvioState, form: FormData): Promise<EnvioState> {
  const { supabase } = await requireAdmin();
  const on = form.get("enabled") === "true";
  const { error } = await supabase.rpc("admin_outreach_settings", { p: { enabled: on, ...(on ? {} : { paused: false }) } });
  if (error) return { error: dbErrorMessage(error) };
  return done(on ? "Envio automático LIGADO." : "Envio automático desligado.");
}

export async function setPaused(_: EnvioState, form: FormData): Promise<EnvioState> {
  const { supabase } = await requireAdmin();
  const paused = form.get("paused") === "true";
  const { error } = await supabase.rpc("admin_outreach_settings", { p: { paused } });
  if (error) return { error: dbErrorMessage(error) };
  return done(paused ? "Envio pausado. Nada sai até você retomar." : "Envio retomado.");
}

export async function cancelMessage(_: EnvioState, form: FormData): Promise<EnvioState> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Mensagem inválida." };
  const { error } = await supabase.rpc("admin_outreach_cancel", { p_id: id.data, p_reason: "cancelada no painel" });
  if (error) return { error: dbErrorMessage(error) };
  return done("Cancelada.");
}

export async function reclassifyReply(_: EnvioState, form: FormData): Promise<EnvioState> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  const kind = z.enum(["automatica", "humana"]).safeParse(form.get("kind"));
  if (!id.success || !kind.success) return { error: "Dados inválidos." };
  const { error } = await supabase.rpc("admin_outreach_reclassify", { p_reply: id.data, p_kind: kind.data });
  if (error) return { error: dbErrorMessage(error) };
  return done("Classificação corrigida.");
}

export async function retryLead(_: EnvioState, form: FormData): Promise<EnvioState> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Lead inválido." };
  const { error } = await supabase.rpc("admin_outreach_retry", { p_lead: id.data });
  if (error) return { error: dbErrorMessage(error) };
  return done("Lead voltou para a fila do Hermes.");
}

export async function createSenderToken(_: EnvioState, form: FormData): Promise<EnvioState> {
  const { supabase } = await requireAdmin();
  const name = String(form.get("name") ?? "").trim().slice(0, 80) || "Enviador no PC";
  const { data, error } = await supabase.rpc("admin_create_sender_token", { p_name: name });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/envio");
  return { ok: "Token do enviador criado. Copie agora: ele não será mostrado de novo.", token: (data as { token: string }).token };
}

export async function setFollowups(_: EnvioState, form: FormData): Promise<EnvioState> {
  const { supabase } = await requireAdmin();
  const on = form.get("enabled") === "true";
  const { error } = await supabase.rpc("admin_outreach_followups", { p_enabled: on });
  if (error) return { error: dbErrorMessage(error) };
  return done(on ? "Lembretes LIGADOS." : "Lembretes desligados.");
}

export async function setAfterNoon(_: EnvioState, form: FormData): Promise<EnvioState> {
  const { supabase } = await requireAdmin();
  const on = form.get("enabled") === "true";
  const { error } = await supabase.rpc("admin_outreach_settings", { p: { prospect_after_noon: on } });
  if (error) return { error: dbErrorMessage(error) };
  return done(on ? "Prospecção liberada depois do meio-dia." : "Prospecção volta a parar no fim do horário.");
}

export async function setSecretary(_: EnvioState, form: FormData): Promise<EnvioState> {
  const { supabase } = await requireAdmin();
  const on = form.get("enabled") === "true";
  const { error } = await supabase.rpc("admin_secretary", { p_enabled: on });
  if (error) return { error: dbErrorMessage(error) };
  return done(on ? "Secretário LIGADO: ele responde as clientes no horário de atendimento." : "Secretário desligado.");
}

export async function returnToSecretary(_: EnvioState, form: FormData): Promise<EnvioState> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Lead inválido." };
  const { error } = await supabase.rpc("admin_secretary_return", { p_lead: id.data });
  if (error) return { error: dbErrorMessage(error) };
  return done("Conversa devolvida ao secretário.");
}
