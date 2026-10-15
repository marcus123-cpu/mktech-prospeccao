"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { KANBAN_KEYS } from "@/lib/kanban";

export type MoveResult = { error?: string };

const input = z.object({
  lead_id: z.uuid(),
  stage: z.enum(KANBAN_KEYS),
  note: z.string().trim().max(500).optional(),
  value: z.number().min(0).max(100000000).optional(),
  closed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Movimento manual de um card. Fechamento exige valor e data; perda exige motivo. */
export async function moveCard(raw: z.input<typeof input>): Promise<MoveResult> {
  const { supabase } = await requireAdmin();
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: "Movimento inválido." };
  const m = parsed.data;
  const { error } = await supabase.rpc("admin_kanban_move", {
    p_lead: m.lead_id, p_stage: m.stage, p_note: m.note ?? null, p_value: m.value ?? null,
    p_closed_at: m.closed_at ? `${m.closed_at}T12:00:00-03:00` : null,
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/kanban"); revalidatePath("/funil"); revalidatePath("/");
  return {};
}
