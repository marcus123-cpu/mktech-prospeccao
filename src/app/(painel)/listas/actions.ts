"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin, dbErrorMessage } from "@/lib/auth";

const id = z.uuid();
const FILTER_KEYS = ["q", "niche", "city", "state", "min_score", "max_score"] as const;

/** Volta para a tela com a lista e os filtros atuais e uma mensagem (ok ou erro). */
function back(form: FormData, message: { ok?: string; erro?: string }): never {
  const p = new URLSearchParams();
  for (const k of ["lista", ...FILTER_KEYS]) {
    const v = form.get(`f_${k}`);
    if (typeof v === "string" && v) p.set(k, v);
  }
  if (message.ok) p.set("ok", message.ok);
  if (message.erro) p.set("erro", message.erro);
  revalidatePath("/listas"); revalidatePath("/disparo");
  redirect(`/listas?${p.toString()}`);
}

function filterFrom(form: FormData): Record<string, string> {
  const f: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = form.get(`f_${k}`);
    if (typeof v === "string" && v.trim()) f[k] = v.trim();
  }
  const open = form.get("f_lista");
  if (typeof open === "string" && open) f.in_list = open;
  return f;
}

export async function createList(form: FormData) {
  const { supabase } = await requireAdmin();
  const name = z.string().trim().min(1).max(80).safeParse(form.get("name"));
  if (!name.success) back(form, { erro: "Informe um nome de até 80 caracteres." });
  const { data, error } = await supabase.rpc("admin_list_create", { p_name: name.data });
  if (error) back(form, { erro: dbErrorMessage(error) });
  form.set("f_lista", String(data));
  back(form, { ok: "Lista criada." });
}

export async function renameList(form: FormData) {
  const { supabase } = await requireAdmin();
  const list = id.safeParse(form.get("list_id")); const name = z.string().trim().min(1).max(80).safeParse(form.get("name"));
  if (!list.success || !name.success) back(form, { erro: "Informe um nome de até 80 caracteres." });
  const { error } = await supabase.rpc("admin_list_rename", { p_list: list.data, p_name: name.data });
  back(form, error ? { erro: dbErrorMessage(error) } : { ok: "Lista renomeada." });
}

export async function deleteList(form: FormData) {
  const { supabase } = await requireAdmin();
  const list = id.safeParse(form.get("list_id"));
  if (!list.success) back(form, { erro: "Lista inválida." });
  const { error } = await supabase.rpc("admin_list_delete", { p_list: list.data });
  form.delete("f_lista");
  back(form, error ? { erro: dbErrorMessage(error) } : { ok: "Lista excluída. Os leads continuam cadastrados." });
}

const summary = (r: { added?: number; duplicates?: number; moved?: number }) =>
  r.moved !== undefined ? `${r.moved} lead(s) movido(s).` : `${r.added ?? 0} adicionado(s)${r.duplicates ? `, ${r.duplicates} já estavam na lista` : ""}.`;

export async function addSelected(form: FormData) {
  const { supabase } = await requireAdmin();
  const list = id.safeParse(form.get("target_list")); const leads = z.array(id).min(1).max(5000).safeParse(form.getAll("lead_ids"));
  if (!list.success) back(form, { erro: "Escolha a lista de destino." });
  if (!leads.success) back(form, { erro: "Selecione ao menos um lead." });
  const { data, error } = await supabase.rpc("admin_list_add", { p_list: list.data, p_leads: leads.data });
  back(form, error ? { erro: dbErrorMessage(error) } : { ok: summary(data) });
}

export async function addAllFiltered(form: FormData) {
  const { supabase } = await requireAdmin();
  const list = id.safeParse(form.get("target_list"));
  if (!list.success) back(form, { erro: "Escolha a lista de destino." });
  const { data, error } = await supabase.rpc("admin_list_add_filtered", { p_list: list.data, f: filterFrom(form) });
  back(form, error ? { erro: dbErrorMessage(error) } : { ok: summary(data) });
}

export async function removeSelected(form: FormData) {
  const { supabase } = await requireAdmin();
  const list = id.safeParse(form.get("list_id")); const leads = z.array(id).min(1).max(5000).safeParse(form.getAll("lead_ids"));
  if (!list.success || !leads.success) back(form, { erro: "Selecione ao menos um lead da lista." });
  const { data, error } = await supabase.rpc("admin_list_remove", { p_list: list.data, p_leads: leads.data });
  back(form, error ? { erro: dbErrorMessage(error) } : { ok: `${data} lead(s) removido(s) da lista.` });
}

export async function moveSelected(form: FormData) {
  const { supabase } = await requireAdmin();
  const from = id.safeParse(form.get("list_id")); const to = id.safeParse(form.get("target_list")); const leads = z.array(id).min(1).max(5000).safeParse(form.getAll("lead_ids"));
  if (!from.success || !to.success || !leads.success) back(form, { erro: "Selecione os leads e a lista de destino." });
  const { data, error } = await supabase.rpc("admin_list_move", { p_from: from.data, p_to: to.data, p_leads: leads.data });
  back(form, error ? { erro: dbErrorMessage(error) } : { ok: summary(data) });
}
