import type { LeadContext } from "@/lib/envio/mensagem";
import { authenticate, json, temporaryFailure } from "@/lib/hermes/api";
import { ESTRATEGIAS, estrategiasPermitidas, sugerirEstrategia, type Contagem } from "@/lib/prospeccao/estrategias";
import { serviceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// GET /api/hermes/v1/envio/pendentes?limit=5 — leads com diagnóstico que
// precisam da mensagem do envio automático (dados, diagnóstico, evidências e
// observações do Marcos), cada um com a estratégia A/B/C sugerida e o motivo.
// Na fase de teste, a sugestão equilibra leads parecidos entre A, B e C.
// Ler não envia nada.
export async function GET(request: Request) {
  const auth = await authenticate(request, "mensagens:escrever");
  if ("response" in auth) return auth.response;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "5");
  const db = serviceClient();
  const [pending, counts] = await Promise.all([
    db.rpc("api_outreach_pending", { p_token: auth.tokenId, p_limit: Number.isFinite(limit) ? Math.trunc(limit) : 5 }),
    db.rpc("api_outreach_strategy_counts", { p_token: auth.tokenId }),
  ]);
  if (pending.error || !pending.data || counts.error) return temporaryFailure();
  const contagens = ((counts.data ?? []) as Contagem[]).map((c) => ({ ...c }));
  const leads = ((pending.data as { leads?: LeadContext[] }).leads ?? []).map((lead) => {
    const s = sugerirEstrategia(lead, contagens);
    const { excluidas } = estrategiasPermitidas(lead);
    return {
      ...lead,
      estrategia: {
        letra: s.estrategia,
        nome: ESTRATEGIAS[s.estrategia].nome,
        objetivo: ESTRATEGIAS[s.estrategia].objetivo,
        referencia: ESTRATEGIAS[s.estrategia].referencia,
        modo: s.modo,
        motivo: s.motivo,
        nao_usar: excluidas,
      },
    };
  });
  return json({ ...(pending.data as object), leads });
}
