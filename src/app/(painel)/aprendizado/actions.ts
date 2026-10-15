"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, dbErrorMessage } from "@/lib/auth";

type State = { error?: string; ok?: string };

export async function startApprenticeship(): Promise<State> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_apprenticeship_start");
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/aprendizado");
  return { ok: "Aprendizado iniciado. O Hermes começa a estudar hoje." };
}

export async function studyNow(): Promise<State> {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_apprenticeship_request_study");
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/aprendizado");
  return { ok: "Pedido enviado. Em alguns minutos o Hermes anota o dia de hoje (o estudante precisa estar ligado no PC)." };
}

export async function setStage(_: State, form: FormData): Promise<State> {
  const { supabase } = await requireAdmin();
  const status = z.enum(["teste", "aprovado", "concluido"]).safeParse(form.get("status"));
  if (!status.success) return { error: "Etapa inválida." };
  const { error } = await supabase.rpc("admin_apprenticeship_set_status", { p_status: status.data });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/aprendizado");
  return { ok: "Etapa atualizada." };
}
