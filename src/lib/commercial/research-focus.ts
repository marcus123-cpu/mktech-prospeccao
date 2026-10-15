import type { Research } from "./engine";

const norm = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Cadastro de candidatos: só fica de fora quem já tem site próprio sem lacuna comprovada no Google.
 * Presença digital ainda não verificada NÃO descarta; o lead entra incompleto para enriquecimento.
 */
export function registrationFocus(research: Research): { accepted: boolean; reason: string } {
  const ownsSite = research.site_status === "site_proprio_encontrado" || Boolean(research.website_url);
  if (!ownsSite) {
    return { accepted: true, reason: research.site_status === "verificacao_pendente" || !research.site_status
      ? "Presença digital a verificar; cadastrado para enriquecimento" : "Página própria não localizada na pesquisa" };
  }
  const focus = researchFocus(research);
  return { accepted: focus.qualified, reason: focus.qualified ? focus.reason : "Já possui site próprio sem lacuna comprovada de visibilidade" };
}

/** Only a missing owned presentation or a documented search-visibility gap fits this campaign. */
export function researchFocus(research: Research): { qualified: boolean; reason: string } {
  const ownsSite = research.site_status === "site_proprio_encontrado" || Boolean(research.website_url);
  if (!ownsSite) {
    if (["site_nao_localizado", "apenas_redes_sociais"].includes(research.site_status ?? "")) {
      return { qualified: true, reason: "Página própria não localizada na pesquisa" };
    }
    return { qualified: false, reason: "Presença digital própria ainda não verificada" };
  }

  const searchEvidence = (research.evidences ?? []).filter(e =>
    ["busca", "google"].includes(e.kind) && e.url && e.observed_at && !e.limitation &&
    /\b(busca|pesquisa|termo|resultado|concorrente)\b/.test(norm(e.summary)) &&
    /\b(nao aparece|nao encontrado|nao localizada|fora da primeira pagina|atras de concorrentes)\b/.test(norm(e.summary))
  );
  const documented = (research.diagnosis?.pains ?? []).some(p =>
    /\b(google|busca|pesquisa|visibilidade|seo|posicionamento)\b/.test(norm(p.pain)) &&
    searchEvidence.some(e => norm(e.summary).includes(norm(p.evidence)))
  );
  return documented
    ? { qualified: true, reason: "Oportunidade de visibilidade no Google documentada" }
    : { qualified: false, reason: "Já tem site e não há lacuna comprovada de visibilidade no Google" };
}
