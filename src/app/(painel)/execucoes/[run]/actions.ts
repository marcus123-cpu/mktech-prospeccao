"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";

export async function reviewResearchLead(_: { error?: string; ok?: string }, form: FormData) {
  const parsed = z.object({
    run_id: z.uuid(), lead_id: z.uuid(), verdict: z.enum(["confirmado", "rejeitado"]),
    evidence: z.string().trim().min(12).max(1000),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Descreva o que você verificou na bio e no destino do link (mínimo 12 caracteres)." };
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_review_research_lead", {
    p_run: parsed.data.run_id, p_lead: parsed.data.lead_id,
    p_verdict: parsed.data.verdict, p_evidence: parsed.data.evidence,
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath(`/execucoes/${parsed.data.run_id}`);
  revalidatePath("/execucoes");
  revalidatePath("/disparo");
  return { ok: parsed.data.verdict === "confirmado" ? "OBS confirmada." : "Lead excluído deste critério." };
}
