import { z } from "zod";
import { authenticate, json, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const schema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

// POST /api/hermes/v1/aprendizado/dia — conversas do dia (só leitura) para o Hermes estudar.
export async function POST(request: Request) {
  const auth = await authenticate(request, "mensagens:escrever");
  if ("response" in auth) return auth.response;
  const body = await parseBody(request, schema);
  if ("response" in body) return body.response;
  const { data, error } = await serviceClient().rpc("api_apprenticeship_day_data", { p_day: body.data.day });
  return error || !data ? temporaryFailure() : json(data);
}
