import { z } from "zod";
import { authenticate, fromDb, parseBody, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const schema = z.object({
  telefone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  message_id: z.string().min(1).max(200),
  direcao: z.enum(["entrada", "saida"]),
  texto: z.string().max(4000).nullable(),
  tipo: z.enum(["texto", "audio", "imagem", "outro"]),
  ocorrida_em: z.iso.datetime(),
  ack: z.number().int().min(-1).max(4).optional(),
});

export async function POST(request: Request) {
  const auth = await authenticate(request, "envio:operar");
  if ("response" in auth) return auth.response;
  const body = await parseBody(request, schema);
  if ("response" in body) return body.response;
  const { data, error } = await serviceClient().rpc("api_conversation_history", { p: body.data });
  if (error) return temporaryFailure();
  return fromDb(data);
}
