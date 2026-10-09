"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { CHANNELS, PRIORITIES, SITE_STATUSES, STAGES } from "@/lib/labels";
import { startApproachNow } from "@/lib/hermes/local";
import { spLocalToIso } from "@/lib/time";

export type ActionState = { error?: string; ok?: string };

const uuid = z.uuid();
const str = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

function refresh(leadId?: string) {
  revalidatePath("/", "layout");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

async function run(fn: () => PromiseLike<{ error: any }>, ok: string, leadId?: string): Promise<ActionState> {
  const { error } = await fn();
  if (error) return { error: dbErrorMessage(error) };
  refresh(leadId);
  return { ok };
}

function parseLocal(value: string, field: string): string {
  try {
    return spLocalToIso(value);
  } catch {
    throw new Error(`${field} inválida`);
  }
}

export async function markContacted(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const lead = uuid.parse(str(form, "lead_id"));
  const channel = z.enum(CHANNELS).catch("whatsapp").parse(str(form, "channel"));
  const at = str(form, "occurred_at");
  let occurredAt = new Date().toISOString();
  try {
    if (at) occurredAt = parseLocal(at, "Data do contato");
  } catch (e) {
    return { error: (e as Error).message };
  }
  return run(
    () =>
      supabase.rpc("admin_mark_contacted", {
        p_lead: lead,
        p_occurred_at: occurredAt,
        p_channel: channel,
        p_note: str(form, "note").slice(0, 2000) || null,
      }),
    "Contato registrado.",
    lead,
  );
}

export async function correctContact(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const event = uuid.parse(str(form, "event_id"));
  const lead = uuid.parse(str(form, "lead_id"));
  const reason = str(form, "reason").slice(0, 500);
  if (!reason) return { error: "Informe o motivo da correção." };
  const newAt = str(form, "new_occurred_at");
  let iso: string | null = null;
  try {
    if (newAt) iso = parseLocal(newAt, "Nova data");
  } catch (e) {
    return { error: (e as Error).message };
  }
  return run(
    () => supabase.rpc("admin_correct_contact", { p_event: event, p_reason: reason, p_new_occurred_at: iso }),
    "Contato corrigido. O registro original foi mantido no histórico.",
    lead,
  );
}

export async function changeStage(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const lead = uuid.parse(str(form, "lead_id"));
  const stage = z.enum(STAGES).safeParse(str(form, "stage"));
  if (!stage.success) return { error: "Etapa inválida." };
  return run(
    () =>
      supabase.rpc("admin_change_stage", {
        p_lead: lead,
        p_stage: stage.data,
        p_note: str(form, "note").slice(0, 2000) || null,
        p_reason: str(form, "reason").slice(0, 500) || null,
      }),
    "Etapa atualizada.",
    lead,
  );
}

export async function addNote(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const lead = uuid.parse(str(form, "lead_id"));
  const body = str(form, "body");
  if (!body) return { error: "Escreva a observação." };
  return run(() => supabase.rpc("admin_add_note", { p_lead: lead, p_body: body.slice(0, 5000) }), "Observação salva.", lead);
}

export async function scheduleFollowUp(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const lead = uuid.parse(str(form, "lead_id"));
  const at = str(form, "at");
  let iso: string | null = null;
  try {
    if (at) iso = parseLocal(at, "Data do retorno");
  } catch (e) {
    return { error: (e as Error).message };
  }
  return run(
    () => supabase.rpc("admin_schedule_follow_up", { p_lead: lead, p_at: iso }),
    iso ? "Retorno agendado." : "Retorno removido.",
    lead,
  );
}

const money = (v: string) => {
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n < 1e10 ? Math.round(n * 100) / 100 : null;
};

export async function registerProposal(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const lead = uuid.parse(str(form, "lead_id"));
  const value = money(str(form, "value"));
  if (value === null) return { error: "Valor inválido." };
  let sentAt: string;
  try {
    sentAt = parseLocal(str(form, "sent_at"), "Data da proposta");
  } catch (e) {
    return { error: (e as Error).message };
  }
  return run(
    () =>
      supabase.rpc("admin_register_proposal", {
        p_lead: lead,
        p_value: value,
        p_sent_at: sentAt,
        p_note: str(form, "note").slice(0, 2000) || null,
      }),
    "Proposta registrada.",
    lead,
  );
}

export async function registerClosing(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const lead = uuid.parse(str(form, "lead_id"));
  const value = money(str(form, "value"));
  if (value === null) return { error: "Valor inválido." };
  let closedAt: string;
  try {
    closedAt = parseLocal(str(form, "closed_at"), "Data do fechamento");
  } catch (e) {
    return { error: (e as Error).message };
  }
  return run(
    () =>
      supabase.rpc("admin_register_closing", {
        p_lead: lead,
        p_value: value,
        p_closed_at: closedAt,
        p_note: str(form, "note").slice(0, 2000) || null,
      }),
    "Fechamento registrado.",
    lead,
  );
}

export async function bulkUpdate(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const ids = form.getAll("ids").map(String).filter((v) => uuid.safeParse(v).success);
  if (ids.length === 0) return { error: "Selecione pelo menos um lead." };
  const action = str(form, "action");
  let value = str(form, "value");
  if (action === "stage" && !(STAGES as readonly string[]).includes(value)) return { error: "Etapa inválida." };
  if (action === "priority" && !(PRIORITIES as readonly string[]).includes(value)) return { error: "Prioridade inválida." };
  if (action === "follow_up") {
    try {
      value = value ? parseLocal(value, "Data do retorno") : "";
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  const { data, error } = await supabase.rpc("admin_bulk_update", { p_leads: ids, p_action: action, p_value: value });
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  return { ok: `${data} leads atualizados.` };
}

function leadPayload(form: FormData) {
  const services = str(form, "services")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
  const site = str(form, "site_status");
  const priority = str(form, "priority");
  const p: Record<string, unknown> = {
    business_name: str(form, "business_name").slice(0, 200),
    responsible_name: str(form, "responsible_name").slice(0, 200),
    niche: str(form, "niche").slice(0, 200),
    services,
    city: str(form, "city").slice(0, 120),
    state: (str(form, "state") || "SP").toUpperCase().slice(0, 2),
    neighborhood: str(form, "neighborhood").slice(0, 120),
    unit_label: str(form, "unit_label").slice(0, 120),
    phone: str(form, "phone").slice(0, 40),
    instagram: str(form, "instagram").slice(0, 200),
    whatsapp_url: str(form, "whatsapp_url").slice(0, 2000),
    website_url: str(form, "website_url").slice(0, 2000),
    selection_reason: str(form, "selection_reason").slice(0, 2000),
    pending_items: str(form, "pending_items").slice(0, 2000),
  };
  if ((SITE_STATUSES as readonly string[]).includes(site)) p.site_status = site;
  if ((PRIORITIES as readonly string[]).includes(priority)) p.priority = priority;
  return p;
}

export type CreateState = ActionState & { review?: { reason: string; matched: string[] } };

export async function createLead(_: CreateState, form: FormData): Promise<CreateState> {
  const { supabase } = await requireAdmin();
  const force = form.get("force") === "1";
  const { data, error } = await supabase.rpc("admin_create_lead", { p: leadPayload(form), p_force: force });
  if (error) return { error: dbErrorMessage(error) };
  const r = data as { status: string; lead_id?: string; errors?: string[]; reason?: string; matched_lead_ids?: string[] };
  if (r.status === "criado" && r.lead_id) {
    refresh();
    redirect(`/leads/${r.lead_id}`);
  }
  if (r.status === "existente" && r.lead_id) redirect(`/leads/${r.lead_id}?ja_existia=1`);
  if (r.status === "possivel_duplicado") {
    refresh();
    return {
      error: "Possível duplicado: o cadastro foi para a fila de revisão.",
      review: { reason: r.reason ?? "", matched: r.matched_lead_ids ?? [] },
    };
  }
  return { error: (r.errors ?? ["Dados inválidos."]).join(" · ") };
}

export async function updateLead(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const lead = uuid.parse(str(form, "lead_id"));
  const { data, error } = await supabase.rpc("admin_update_lead", { p_lead: lead, p: leadPayload(form) });
  if (error) return { error: dbErrorMessage(error) };
  const r = data as { status: string; errors?: string[] };
  if (r.status !== "atualizado") return { error: (r.errors ?? ["Dados inválidos."]).join(" · ") };
  refresh(lead);
  return { ok: "Dados atualizados." };
}

export async function resolveReview(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const review = uuid.parse(str(form, "review_id"));
  const action = z.enum(["criar_novo", "vincular", "descartar"]).parse(str(form, "action"));
  const leadId = str(form, "lead_id");
  const unit = str(form, "unit_label");
  const { data, error } = await supabase.rpc("admin_resolve_review", {
    p_review: review,
    p_action: action,
    p_lead: action === "vincular" && uuid.safeParse(leadId).success ? leadId : null,
    p_overrides: unit ? { unit_label: unit.slice(0, 120) } : {},
    p_note: str(form, "note").slice(0, 1000) || null,
  });
  if (error) return { error: dbErrorMessage(error) };
  const r = data as { status: string; errors?: string[] };
  if (r.status !== "resolvida") {
    return { error: (r.errors ?? [`Não foi possível criar: ${r.status}. Informe uma unidade diferente.`]).join(" · ") };
  }
  refresh();
  return { ok: "Revisão resolvida." };
}

export async function deleteLead(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await requireAdmin();
  const lead = uuid.parse(str(form, "lead_id"));
  const reason = str(form, "reason").slice(0, 500);
  if (!reason) return { error: "Informe o motivo da exclusão." };
  if (str(form, "confirm") !== "EXCLUIR") return { error: "Digite EXCLUIR para confirmar." };
  const { error } = await supabase.rpc("admin_delete_lead", { p_lead: lead, p_reason: reason });
  if (error) return { error: dbErrorMessage(error) };
  refresh();
  redirect("/leads?excluido=1");
}

// ---- Abordagem (rascunhos de mensagem; nada é enviado pelo sistema) ----

export type MessageResult = { error?: string; id?: string; started?: boolean };

/** Salva o texto editado como versão nova; a versão anterior continua no histórico. */
export async function saveMessageVersion(messageId: string, body: string): Promise<MessageResult> {
  const { supabase } = await requireAdmin();
  const id = uuid.safeParse(messageId);
  const text = String(body ?? "").trim();
  if (!id.success) return { error: "Mensagem inválida." };
  if (!text || text.length > 500) return { error: "A mensagem precisa ter entre 1 e 500 caracteres." };
  const { data, error } = await supabase.rpc("admin_save_message_version", { p_parent: id.data, p_body: text });
  if (error) return { error: dbErrorMessage(error) };
  return { id: data as string };
}

/** "Usei esta": salva o texto atual (se mudou) e registra o uso. Não muda a etapa. */
export async function markMessageUsed(leadId: string, messageId: string, body: string): Promise<MessageResult> {
  const saved = await saveMessageVersion(messageId, body);
  if (saved.error || !saved.id) return saved;
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_mark_message_used", { p_message: saved.id });
  if (error) return { error: dbErrorMessage(error) };
  refresh(uuid.safeParse(leadId).success ? leadId : undefined);
  return { id: saved.id };
}

/** Pede ao Hermes novas variantes na próxima execução. */
export async function requestApproach(leadId: string): Promise<MessageResult> {
  const { supabase } = await requireAdmin();
  const id = uuid.safeParse(leadId);
  if (!id.success) return { error: "Lead inválido." };
  const { error } = await supabase.rpc("admin_request_approach", { p_lead: id.data });
  if (error) return { error: dbErrorMessage(error) };
  const started = startApproachNow();
  refresh(id.data);
  return { id: id.data, started };
}
