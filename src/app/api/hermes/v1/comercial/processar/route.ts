import { decide, scoreResearch, type Context } from "@/lib/commercial/engine";
import { authenticate, json, temporaryFailure } from "@/lib/hermes/api";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Worker chama este endpoint. Regras e textos são gerados no servidor, nunca aceitos do cliente. */
export async function POST(request: Request) {
  const auth = await authenticate(request, "mensagens:escrever");
  if ("response" in auth) return auth.response;
  const db = serviceClient();
  const settings=await db.from('commercial_settings').select('engine_version').eq('id',1).single();
  if(settings.error)return temporaryFailure();
  if(settings.data.engine_version==='v6')return json({status:'v6',results:[]});
  const pending = await db.rpc("api_commercial_pending", { p_token: auth.tokenId, p_limit: 10 });
  if (pending.error || !pending.data) return temporaryFailure();
  const results: { lead_id: string; status: string }[] = [];
  for (const raw of pending.data.contexts ?? []) {
    // Erro em um lead não impede processar os demais.
    try {
      const ctx: Context = { ...raw, products: (raw.products ?? []).map((p: { price: unknown }) => ({ ...p, price: Number(p.price) })) };
      const decision = decide(ctx);
      const { data, error } = await db.rpc("api_commercial_save", {
        p_token: auth.tokenId, p_lead: raw.lead_id, p_revision: raw.revision,
        p_reply: raw.reply_id ?? null, p: { ...decision, score: scoreResearch(ctx.research, ctx.now) },
      });
      results.push({ lead_id: raw.lead_id, status: error ? "falha_temporaria" : data?.status ?? "falha_temporaria" });
    } catch {
      results.push({ lead_id: raw.lead_id, status: "contexto_invalido" });
    }
  }
  return json({ status: pending.data.status, results });
}
