import { z } from "zod";
import { authenticate, json, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";
import { additionSchema, mergePlaybook } from "@/lib/aprendizado";

export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dia"), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().min(1).max(20000), additions: z.array(additionSchema).max(25).default([]) }).strict(),
  z.object({ kind: z.literal("final"), report: z.string().min(1).max(40000) }).strict(),
]);

// POST /api/hermes/v1/aprendizado/salvar — grava a nota do dia (e mescla o aprendizado.md) ou o relatório final.
export async function POST(request: Request) {
  const auth = await authenticate(request, "mensagens:escrever");
  if ("response" in auth) return auth.response;
  const body = await parseBody(request, schema);
  if ("response" in body) return body.response;
  const db = serviceClient();
  if (body.data.kind === "final") {
    const { error } = await db.rpc("api_apprenticeship_save_final", { p_text: body.data.report });
    return error ? temporaryFailure() : json({ status: "ok" });
  }
  const state = await db.rpc("api_apprenticeship_state");
  if (state.error || !state.data) return temporaryFailure();
  const saved = await db.rpc("api_apprenticeship_save_day", { p_day: body.data.day, p_notes: body.data.notes });
  if (saved.error) return saved.error.code === "22023" ? json({ status: "invalido", errors: [saved.error.message] }, 422) : temporaryFailure();
  const { markdown, added } = mergePlaybook(String(state.data.playbook ?? ""), body.data.additions);
  const pb = await db.rpc("api_apprenticeship_save_playbook", { p_text: markdown });
  return pb.error ? temporaryFailure() : json({ status: "ok", added });
}
