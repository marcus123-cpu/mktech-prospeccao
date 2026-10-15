"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, dbErrorMessage } from "@/lib/auth";

type State = { error?: string; ok?: string };

export async function decideLearning(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const parsed = z.object({ id: z.uuid(), status: z.enum(["ativa", "recusada", "pendente"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Ação inválida." };
  const { error } = await supabase.rpc("admin_learning_set", { p_id: parsed.data.id, p_status: parsed.data.status });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/aprendizados");
  return { ok: parsed.data.status === "ativa" ? "Aprendizado ativado. O Hermes passa a usar nas próximas conversas." : "Feito." };
}

export async function addLearning(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const text = z.string().trim().min(15, "Escreva pelo menos 15 caracteres.").max(300, "No máximo 300 caracteres.").safeParse(form.get("lesson"));
  if (!text.success) return { error: text.error.issues[0].message };
  const { error } = await supabase.rpc("admin_learning_add", { p_text: text.data });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/aprendizados");
  return { ok: "Ensinado. O Hermes já usa nas próximas conversas." };
}
