"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";

export type FunilState = { error?: string; ok?: string };

export async function clearPriceQuestion(_: FunilState, form: FormData): Promise<FunilState> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Lead inválido." };
  const { error } = await supabase.rpc("admin_clear_price_question", { p_lead: id.data });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/funil");
  return { ok: "Ok" };
}

export async function archiveFromFunnel(_: FunilState, form: FormData): Promise<FunilState> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Lead inválido." };
  const archived = form.get("archived") === "1";
  const { error } = await supabase.rpc("admin_funnel_archive", { p_lead: id.data, p_archived: archived });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/funil");
  return { ok: "Ok" };
}

export async function removeFromQueue(_: FunilState, form: FormData): Promise<FunilState> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Lead inválido." };
  const { error } = await supabase.rpc("admin_queue_remove_lead", { p_lead: id.data });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/funil");
  revalidatePath("/disparo");
  return { ok: "Ok" };
}
