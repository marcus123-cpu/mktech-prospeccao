"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";

export type PedidoState = { error?: string; ok?: string };

export async function requestSearch(_: PedidoState, form: FormData): Promise<PedidoState> {
  const { supabase } = await requireAdmin();
  const n = z.coerce.number().int().min(1).max(100).safeParse(form.get("quantidade"));
  if (!n.success) return { error: "Digite de 1 a 100." };
  const { error } = await supabase.rpc("admin_search_request", { p_target: n.data });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/execucoes");
  return { ok: "Pedido enviado. O PC chama o Hermes em até 2 minutos." };
}

export async function cancelSearch(_: PedidoState, form: FormData): Promise<PedidoState> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Pedido inválido." };
  const { error } = await supabase.rpc("admin_search_request_cancel", { p_id: id.data });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/execucoes");
  return { ok: "Pedido cancelado." };
}
