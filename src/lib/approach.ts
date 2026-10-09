// Regras da aba Abordagem. Funções puras: a API usa para recusar o que o
// Hermes escreveu fora das regras (ele reescreve), e a tela usa as mesmas
// regras para avisar o Marcos enquanto ele edita.

export const STYLES = ["direta", "pulga", "consultiva"] as const;
export type Style = (typeof STYLES)[number];
export type Risk = "baixo" | "medio" | "alto";

export const STYLE_LABEL: Record<Style, string> = {
  direta: "Direta",
  pulga: "Pulga atrás da orelha",
  consultiva: "Consultiva",
};

export const MAX_CHARS = 500;
export const WEAK_ALERT = "Poucas evidências. Recomendo confirmar antes de abordar.";

export type ApproachContext = {
  business_name: string;
  responsible_name?: string | null;
  niche?: string | null;
  city?: string | null;
  state?: string | null;
  neighborhood?: string | null;
  services?: string[] | null;
  site_status?: string | null;
  pending_items?: string | null;
  website_url?: string | null;
  instagram_handle?: string | null;
  phone_e164?: string | null;
  selection_reason?: string | null;
  diagnosis?: {
    confidence?: string | null;
    summary?: string | null;
    digital_presence?: string | null;
    pains?: { pain: string; evidence: string }[] | null;
    opportunities?: string[] | null;
    offer_reason?: string | null;
  } | null;
  evidences?: { kind?: string; url?: string | null; summary: string; observed_at?: string | null; limitation?: string | null }[] | null;
  notes?: string[] | null;
};

export type Variant = {
  estilo: Style;
  mensagem: string;
  dor_usada?: string | null;
  evidencia_usada?: string | null;
  risco: Risk;
};

export type ApproachPayload = { alerta?: string | null; variantes: Variant[] };

/** Minúsculas e sem acento, para comparar texto do Hermes com as fontes. */
export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function firstName(ctx: Pick<ApproachContext, "responsible_name">): string | null {
  const n = (ctx.responsible_name ?? "").trim().split(/\s+/)[0];
  return n && n.length > 1 ? n : null;
}

/** Verificação pendente ou confiança baixa: só frases condicionais. */
export function needsCaution(ctx: ApproachContext): boolean {
  return ctx.site_status === "verificacao_pendente" || ctx.diagnosis?.confidence === "baixa";
}

/** Sem dor documentada ou sem evidência: só uma variante consultiva + alerta. */
export function weakEvidence(ctx: ApproachContext): boolean {
  const pains = ctx.diagnosis?.pains ?? [];
  const ev = ctx.evidences ?? [];
  return !ctx.diagnosis || pains.length === 0 || ev.length === 0 || (ctx.diagnosis.confidence === "baixa" && ev.length < 2);
}

/** Tudo o que a mensagem pode citar como fato. */
function sourceText(ctx: ApproachContext): string {
  const d = ctx.diagnosis;
  return norm(
    [
      ctx.business_name,
      ctx.responsible_name,
      ctx.niche,
      ctx.city,
      ctx.state,
      ctx.neighborhood,
      ...(ctx.services ?? []),
      ctx.website_url,
      ctx.instagram_handle,
      ctx.selection_reason,
      d?.summary,
      d?.digital_presence,
      d?.offer_reason,
      ...(d?.opportunities ?? []),
      ...(d?.pains ?? []).flatMap((p) => [p.pain, p.evidence]),
      ...(ctx.evidences ?? []).flatMap((e) => [e.url, e.summary, e.limitation]),
      ...(ctx.notes ?? []),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

const STOP = new Set(
  "para pela pelo pelos pelas como mais menos sobre entre quando onde voce voces esta este essa esse isso isto seus suas sua seu nossa nosso tambem ainda muito pouco hoje aqui todo toda todos todas fazer feito pode podem desde apos antes depois cada qual quais porque assim mesmo outra outro foram sendo seria uma umas uns pois tem sem com que dos das nos nas aos ate".split(
    " ",
  ),
);

function words(s: string): Set<string> {
  return new Set(norm(s).match(/[a-z0-9]{4,}/g)?.filter((w) => !STOP.has(w)) ?? []);
}

const PRESSURE = [
  /ultima chance/, /so hoje/, /\bcorr[ae]\b/, /nao perca/, /urgente/, /vagas? limitadas?/, /garanta (ja|o seu|a sua)/,
  /imperdivel/, /agora mesmo/, /antes que seja tarde/, /aproveite/, /promocao/, /oferta especial/, /desconto/,
  /ficando para tras/, /esta perdendo dinheiro/,
];
const PRAISE = [
  /trabalho (e |eh )?(incrivel|lindo|maravilhoso|sensacional|perfeito|top)/, /perfil (e |eh )?(incrivel|lindo|maravilhoso|sensacional)/,
  /amei (seu|o seu|teu)/, /adorei (seu|o seu|teu)/, /parabens pelo (seu )?trabalho/, /sou (muito )?(fa|sua fa)/,
  /que trabalho/, /\bsensacional\b/, /\bmaravilhos[oa]\b/, /\bincrivel\b/,
];
const AI = [
  /inteligencia artificial/, /\brobo\b/, /\bbot\b/, /\bsistema\b/, /automati/, /\balgoritmo/, /chatgpt/, /\bgpt\b/,
  /\bhermes\b/, /\bcrm\b/, /gerad[ao] automaticamente/, /\bagente\b/,
];
// Afirmações que só valem com verificação concluída.
const ASSERTIVE = [
  /(nao (tem|possui|tenha)|esta sem|ficar sem|\bsem) (um |uma |o |a )?(site|pagina|agendamento|dominio)/,
  /(nao (tem|possui)|sem) (nenhum |nenhuma )?(presenca|endereco) (online|na internet|digital)/,
];
const LOST_CLIENTS = /perd\w* (de |muitos? |muitas? |seus |suas |os |as )?(clientes|pacientes|vendas|agendamentos)/;
const CONDITIONAL = /\b(se|caso|talvez|sera que|pode ser que)\b/;
const PROCEDURES: [RegExp, string][] = [
  [/botox|toxina botulinica/, "botox"], [/preenchimento/, "preenchimento"], [/harmonizacao/, "harmonizacao"],
  [/bioestimulador/, "bioestimulador"], [/\bfios? (de )?pdo|\bfios de sustentacao/, "fios"], [/criolipolise/, "criolipolise"],
  [/\blipo/, "lipo"], [/depilacao/, "depilacao"], [/\blaser\b/, "laser"], [/microagulhamento/, "microagulhamento"],
  [/peeling/, "peeling"], [/limpeza de pele/, "limpeza de pele"], [/skinbooster/, "skinbooster"], [/rinomodelacao/, "rinomodelacao"],
  [/bichectomia/, "bichectomia"], [/drenagem/, "drenagem"], [/massage/, "massag"], [/micropigmentacao/, "micropigmentacao"],
  [/sobrancelha/, "sobrancelha"], [/\bcilios|lash/, "cilios"], [/\bacne\b/, "acne"], [/rejuvenescimento/, "rejuvenescimento"],
  [/emagrecimento/, "emagrecimento"], [/radiofrequencia/, "radiofrequencia"], [/carboxiterapia/, "carboxiterapia"],
  [/ultraformer|ultrassom microfocado/, "ultraformer"], [/hidratacao labial/, "hidratacao labial"], [/full face/, "full face"],
];
const CITIES = [
  "fernandopolis", "votuporanga", "sao jose do rio preto", "rio preto", "bauru", "marilia", "jales", "santa fe do sul",
  "catanduva", "aracatuba", "presidente prudente", "ribeirao preto", "campinas", "sao paulo", "mirassol", "birigui",
  "lins", "assis", "ourinhos", "barretos", "olimpia", "urania", "estrela d'oeste", "meridiano", "ouroeste",
];

function sentences(s: string): string[] {
  return norm(s)
    .split(/[.!?\n]+/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter((x) => x.length >= 25);
}

/**
 * Problemas de uma mensagem isolada (servem para a tela, durante a edição).
 * Lista vazia = dentro das regras.
 */
export function messageIssues(ctx: ApproachContext, msg: string): string[] {
  const out: string[] = [];
  const text = msg.trim();
  const n = norm(text);
  const src = sourceText(ctx);
  if (!text) return ["Mensagem vazia."];
  if (text.length > MAX_CHARS) out.push(`Passou de ${MAX_CHARS} caracteres (${text.length}).`);

  const q = (text.match(/\?/g) ?? []).length;
  if (q > 1) out.push("Use só uma pergunta, no final.");
  if (q === 1 && /[a-zà-ú]{3,}/i.test(text.slice(text.lastIndexOf("?") + 1))) {
    out.push("A pergunta precisa ficar no final.");
  }

  if (PRESSURE.some((r) => r.test(n))) out.push("Tem frase de pressão; tire.");
  if (PRAISE.some((r) => r.test(n))) out.push("Tem elogio genérico; cite algo concreto ou tire.");
  if (AI.some((r) => r.test(n)) || /\bI\.?A\b/.test(text)) out.push("Não mencione IA, sistema ou automação.");
  if (/\b(prezad[ao]|vossa|\btu\b|\bteu\b|\btua\b)/.test(n)) out.push("Trate por \"você\".");

  if (needsCaution(ctx)) {
    for (const r of ASSERTIVE) {
      const m = r.exec(n);
      if (m && !CONDITIONAL.test(n.slice(Math.max(0, m.index - 40), m.index))) {
        out.push(`Verificação pendente: não afirme "${m[0]}"; use forma condicional.`);
      }
    }
  }
  if (LOST_CLIENTS.test(n)) out.push("Não afirme que perde clientes: não há prova disso.");

  for (const num of n.match(/\d+(?:[.,/:]\d+)*/g) ?? []) {
    if (!src.includes(num)) out.push(`O número "${num}" não está nos dados do lead.`);
  }
  if (/r\$/.test(n) && !src.includes("r$")) out.push("Não cite preço.");
  if (/\b(estrelas|nota \d|avaliacoes no google)/.test(n) && !/(estrelas|avaliacoes no google|nota \d)/.test(src)) {
    out.push("Não cite nota ou avaliações que não estão nos dados.");
  }
  if (/concorr/.test(n) && !/concorr/.test(src)) out.push("Não cite concorrentes.");

  for (const [r, stem] of PROCEDURES) {
    if (r.test(n) && !src.includes(stem)) out.push(`Procedimento "${stem}" não aparece nos dados do lead.`);
  }

  const pending = norm(ctx.pending_items ?? "");
  for (const c of CITIES) {
    if (!new RegExp(`\\b${c}\\b`).test(n)) continue;
    if (!src.includes(c)) out.push(`Cidade "${c}" não está nos dados do lead.`);
    else if (pending.includes(c)) out.push(`A cidade "${c}" ainda está para confirmar; não afirme.`);
  }

  for (const host of n.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|med|br|site|io)(?:\.br)?\b/g) ?? []) {
    if (!src.includes(host.replace(/^www\./, ""))) out.push(`O endereço "${host}" não está nos dados do lead.`);
  }

  const first = firstName(ctx);
  if (first && !n.includes(norm(first))) out.push(`Use o primeiro nome (${first}).`);
  return out;
}

/** Valida o lote inteiro que o Hermes quer gravar. */
export function validateApproach(ctx: ApproachContext, p: ApproachPayload): string[] {
  const errors: string[] = [];
  const vs = p.variantes ?? [];
  const weak = weakEvidence(ctx);
  if (weak) {
    if (vs.length !== 1 || vs[0]?.estilo !== "consultiva") {
      errors.push("Evidência fraca: envie só UMA variante, consultiva.");
    }
    if (norm(p.alerta ?? "") !== norm(WEAK_ALERT)) errors.push(`Evidência fraca: alerta deve ser "${WEAK_ALERT}"`);
  } else {
    const styles = vs.map((v) => v.estilo).sort().join(",");
    if (vs.length !== 3 || styles !== "consultiva,direta,pulga") {
      errors.push("Envie exatamente 3 variantes: direta, pulga e consultiva (uma de cada).");
    }
  }

  const evidenceText = norm(
    [...(ctx.evidences ?? []).flatMap((e) => [e.url, e.summary]), ...(ctx.diagnosis?.pains ?? []).map((x) => x.evidence), ctx.website_url, ...(ctx.notes ?? [])]
      .filter(Boolean)
      .join("\n"),
  );
  const evWords = words(evidenceText);
  const nameWords = words(`${ctx.business_name} ${ctx.responsible_name ?? ""}`);

  vs.forEach((v, i) => {
    const tag = `variante ${i + 1} (${v.estilo})`;
    if (v.risco === "alto") errors.push(`${tag}: risco alto; reescreva de forma condicional e reavalie o risco.`);
    for (const issue of messageIssues(ctx, v.mensagem)) errors.push(`${tag}: ${issue}`);
    if (v.estilo === "direta" || v.estilo === "pulga") {
      const used = v.evidencia_usada ?? "";
      const overlap = [...words(used)].filter((w) => evWords.has(w) && !nameWords.has(w));
      const urlHit = (used.match(/[a-z0-9-]+\.[a-z.]{2,}/gi) ?? []).some((u) => evidenceText.includes(norm(u)));
      if (!used.trim() || (overlap.length < 3 && !urlHit)) {
        errors.push(`${tag}: evidencia_usada precisa citar uma evidência real do lead.`);
      }
      const cited = [...words(v.mensagem)].filter((w) => evWords.has(w) && !nameWords.has(w));
      if (cited.length < 2) errors.push(`${tag}: a mensagem precisa citar um elemento observado (post, link, data, serviço).`);
    }
  });

  const seen = new Map<string, number>();
  vs.forEach((v, i) =>
    sentences(v.mensagem).forEach((s) => {
      const j = seen.get(s);
      if (j !== undefined && j !== i) errors.push(`Frase repetida entre variantes: "${s.slice(0, 60)}".`);
      seen.set(s, i);
    }),
  );
  return [...new Set(errors)];
}

/** Link do WhatsApp com o texto pronto (acentos e quebras de linha preservados). */
export function whatsappWithText(phoneE164: string | null | undefined, text: string): string | null {
  const digits = (phoneE164 ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const full = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}
