"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { researchSchema } from "@/lib/research";

export type PedidoState = { error?: string; ok?: string };

export async function requestSearch(_: PedidoState, form: FormData): Promise<PedidoState> {
  const { supabase } = await requireAdmin();
  const parsed = researchSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Revise os campos da pesquisa." };
  const r = parsed.data;
  const { error } = await supabase.rpc("admin_search_request_v3", { p_observations: r.observations, p_target: r.target, p_niche: r.niche, p_scope: r.scope, p_state: r.state ?? null, p_city: r.city ?? null });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/execucoes"); revalidatePath("/hermes");
  return { ok: "Pesquisa iniciada. O PC chama o Hermes em até 2 minutos; a meta é um alvo e o relatório explica qualquer diferença." };
}

export async function cancelSearch(_: PedidoState, form: FormData): Promise<PedidoState> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Pedido inválido." };
  const { error } = await supabase.rpc("admin_search_request_cancel", { p_id: id.data });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/execucoes"); revalidatePath("/hermes");
  return { ok: "Pedido cancelado." };
}
