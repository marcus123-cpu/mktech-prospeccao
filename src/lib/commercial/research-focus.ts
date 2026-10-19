import type { Research } from "./engine";

const norm = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Endereços que são rede social ou agregador de links: não são site próprio. */
const SOCIAL = /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.me|linktr\.ee|linktree\.com|beacons\.ai|bio\.link|taplink\.cc|wa\.me|whatsapp\.com|api\.whatsapp\.com|tiktok\.com|youtube\.com|youtu\.be|google\.com|goo\.gl|g\.page|maps\.app\.goo\.gl|ifood\.com\.br|booksy\.com|trinks\.com|doctoralia\.com\.br|olx\.com\.br|mercadolivre\.com\.br)$/;
function ownsWebsite(url?: string | null): boolean {
  if (!url?.trim()) return false;
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
    return !SOCIAL.test(host);
  } catch { return true; }
}

export type RegistrationVerdict = { accepted: boolean; reason: string; code: "ok" | "ja_possui_site" | "verificacao_pendente" | "sem_busca_google" | "instagram_nao_verificado" };

/**
 * Cadastro de candidatos — critério OBRIGATÓRIO: só entra negócio SEM site, confirmado.
 *  - nenhum site próprio (nem no Google, nem no link da bio do Instagram);
 *  - "sem site" confirmado (`site_nao_localizado` ou `apenas_redes_sociais`), nunca "verificação pendente";
 *  - a busca no Google/web precisa estar registrada como evidência sem limitação;
 *  - se há Instagram, a bio precisa ter sido aberta (evidência `instagram` sem limitação).
 * Quem já tem site é descartado, mesmo com lacuna de visibilidade.
 */
export function registrationFocus(research: Research): RegistrationVerdict {
  if (research.site_status === "site_proprio_encontrado" || ownsWebsite(research.website_url)) {
    return { accepted: false, code: "ja_possui_site", reason: "Já possui site próprio: fora do critério (só entra quem não tem site)" };
  }
  if (research.site_status !== "site_nao_localizado" && research.site_status !== "apenas_redes_sociais") {
    return { accepted: false, code: "verificacao_pendente", reason: "Verificação de site pendente: só é cadastrado quem teve 'sem site' CONFIRMADO. Conclua a busca no Google e a bio do Instagram e envie site_status site_nao_localizado ou apenas_redes_sociais" };
  }
  const evidences = research.evidences ?? [];
  const confirmed = (kinds: string[]) => evidences.some(e => kinds.includes(e.kind) && !e.limitation);
  if (!confirmed(["google", "busca"])) {
    return { accepted: false, code: "sem_busca_google", reason: "Falta a evidência da busca no Google (kind google ou busca, sem limitation) mostrando que não há site do negócio" };
  }
  if (research.instagram?.trim() && !confirmed(["instagram"])) {
    return { accepted: false, code: "instagram_nao_verificado", reason: "Instagram informado sem a bio verificada: abra o perfil e registre a evidência instagram (sem limitation) confirmando que não há link para site" };
  }
  return { accepted: true, code: "ok", reason: "Sem site confirmado no Google e na bio do Instagram" };
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
