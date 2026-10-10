// Regras da mensagem do envio automático. Funções puras: a API recusa o que o
// Hermes escreveu fora das regras (o lead é pulado e nada é enviado), e o
// painel usa as mesmas regras para mostrar o motivo.
//
// A mensagem chega ao cliente exatamente como foi salva aqui, então qualquer
// sinal de saída técnica do agente (erro, JSON, código, recusa do modelo)
// derruba a mensagem inteira.

export const MIN_CHARS = 120;
export const MAX_CHARS = 600;

export type LeadContext = {
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
  selection_reason?: string | null;
  diagnosis?: {
    confidence?: string | null;
    summary?: string | null;
    digital_presence?: string | null;
    pains?: { pain: string; evidence: string }[] | null;
    opportunities?: string[] | null;
    offer?: string | null;
    offer_reason?: string | null;
    approach?: string | null;
  } | null;
  evidences?: { kind?: string; url?: string | null; summary: string; limitation?: string | null }[] | null;
  notes?: string[] | null;
};

export type OutreachPayload = { elogio: string; dor: string; melhoria: string; mensagem: string };

/** Minúsculas e sem acento, para comparar texto do Hermes com as fontes. */
export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const STOP = new Set(
  "para pela pelo pelos pelas como mais menos sobre entre quando onde voce voces esta este essa esse isso isto seus suas sua seu nossa nosso tambem ainda muito pouco hoje aqui todo toda todos todas fazer feito pode podem desde apos antes depois cada qual quais porque assim mesmo outra outro foram sendo seria uma umas uns pois tem sem com que dos das nos nas aos ate vi vou ver".split(
    " ",
  ),
);

export function words(s: string): Set<string> {
  return new Set(norm(s).match(/[a-z0-9]{4,}/g)?.filter((w) => !STOP.has(w)) ?? []);
}

function overlap(a: Set<string>, b: Set<string>, ignore: Set<string> = new Set()): number {
  let n = 0;
  for (const w of a) if (b.has(w) && !ignore.has(w)) n += 1;
  return n;
}

/** Tudo o que a mensagem pode citar como fato. */
function sourceText(ctx: LeadContext): string {
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
      d?.approach,
      ...(d?.opportunities ?? []),
      ...(d?.pains ?? []).flatMap((p) => [p.pain, p.evidence]),
      ...(ctx.evidences ?? []).flatMap((e) => [e.url, e.summary, e.limitation]),
      ...(ctx.notes ?? []),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/** Texto que denuncia saída técnica do agente, nunca pode chegar ao cliente. */
const TECHNICAL = [
  /\berr(o|or)\b/, /ocorreu um (erro|problema)/, /\bexception\b/, /traceback/, /\bstack\b/, /\bundefined\b/, /\bnull\b/,
  /\bnan\b/, /\bjson\b/, /\bapi\b/, /\bhttp/, /\bstatus\b/, /\bfalha(ou)? (na|no|ao)\b/, /tente novamente/, /\btimeout\b/,
  /\btoken\b/, /\bprompt\b/, /como (um )?(modelo|assistente|ia)\b/, /nao (posso|consigo) (ajudar|gerar|escrever)/,
  /\bdesculpe\b/, /\bsinto muito\b/, /\b(lead|leads)\b/, /\bdiagnostico\b/, /\bfit_score\b/, /\bpains?\b/, /\bmensagem:/,
  /\belogio:/, /\bdor:/, /\bmelhoria:/, /\[|\]|\{|\}|<|>|`|\*\*|#|_{2,}|\\n/,
];
const PRESSURE = [
  /ultima chance/, /so hoje/, /nao perca/, /urgente/, /vagas? limitadas?/, /garanta (ja|o seu|a sua)/, /imperdivel/,
  /agora mesmo/, /antes que seja tarde/, /aproveite/, /promocao/, /oferta especial/, /desconto/, /ficando para tras/,
  /esta perdendo dinheiro/,
];
const AI = [
  /inteligencia artificial/, /\brobo\b/, /\bbot\b/, /\bsistema\b/, /automati/, /\balgoritmo/, /chatgpt/, /\bgpt\b/,
  /\bhermes\b/, /\bcrm\b/, /gerad[ao] automaticamente/, /\bagente\b/,
];
const GENERIC_PRAISE = [
  /trabalho (e |eh )?(incrivel|lindo|maravilhoso|sensacional|perfeito|top)/, /perfil (e |eh )?(incrivel|lindo|maravilhoso|sensacional)/,
  /amei (seu|o seu|teu)/, /adorei (seu|o seu|teu)/, /sou (muito )?(fa|sua fa)/,
];
const GREETING_START = /^(bom dia|boa tarde|boa noite|ola|oi|e ai|tudo bem)\b/;
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
  [/bichectomia/, "bichectomia"], [/drenagem/, "drenagem"], [/micropigmentacao/, "micropigmentacao"], [/sobrancelha/, "sobrancelha"],
  [/\bcilios|lash/, "cilios"], [/rejuvenescimento/, "rejuvenescimento"], [/emagrecimento/, "emagrecimento"],
  [/radiofrequencia/, "radiofrequencia"], [/ultraformer|ultrassom microfocado/, "ultraformer"], [/full face/, "full face"],
];

/** Verificação pendente ou confiança baixa: só frases condicionais sobre o site. */
function needsCaution(ctx: LeadContext): boolean {
  return ctx.site_status === "verificacao_pendente" || ctx.diagnosis?.confidence === "baixa";
}

/** Problemas da mensagem. Lista vazia = pode ir para a fila. */
export function validateOutreach(ctx: LeadContext, p: OutreachPayload): string[] {
  const out: string[] = [];
  const text = (p.mensagem ?? "").trim();
  const n = norm(text);
  const src = sourceText(ctx);

  if (!ctx.diagnosis) out.push("Lead sem diagnóstico: não dá para escrever a mensagem.");
  if (text.length < MIN_CHARS) out.push(`Mensagem curta demais (mínimo ${MIN_CHARS} caracteres).`);
  if (text.length > MAX_CHARS) out.push(`Passou de ${MAX_CHARS} caracteres (${text.length}).`);
  if (GREETING_START.test(n)) out.push("Não comece com saudação: o bom dia/boa noite é enviado antes, separado.");

  const all = norm([p.elogio, p.dor, p.melhoria, text].join("\n"));
  if (TECHNICAL.some((r) => r.test(all))) out.push("Tem texto técnico ou de erro; a mensagem não pode ter isso.");
  if (PRESSURE.some((r) => r.test(n))) out.push("Tem frase de pressão; tire.");
  if (AI.some((r) => r.test(n)) || /\bI\.?A\b/.test(text)) out.push("Não mencione IA, sistema ou automação.");
  if (GENERIC_PRAISE.some((r) => r.test(n))) out.push("Elogio genérico; elogie algo concreto que aparece nas evidências.");
  if (/\b(prezad[ao]|vossa|\btu\b|\bteu\b|\btua\b)/.test(n)) out.push('Trate por "você".');
  if (/https?:|www\.|\.com\b|\.br\b/.test(n)) out.push("Não coloque links na primeira mensagem.");
  if (/r\$|\breais\b/.test(n)) out.push("Não cite preço.");
  if ((text.match(/\?/g) ?? []).length > 1) out.push("Use no máximo uma pergunta, no final.");
  if (/\?/.test(text) && /[a-zà-ú]{3,}/i.test(text.slice(text.lastIndexOf("?") + 1))) out.push("A pergunta precisa ficar no final.");
  if ((text.match(/\p{Extended_Pictographic}/gu) ?? []).length > 2) out.push("No máximo 2 emojis.");
  if (/[A-ZÀ-Ú]{6,}/.test(text)) out.push("Não escreva palavras em CAIXA ALTA.");

  if (needsCaution(ctx)) {
    for (const r of ASSERTIVE) {
      const m = r.exec(n);
      if (m && !CONDITIONAL.test(n.slice(Math.max(0, m.index - 40), m.index))) {
        out.push(`Site ainda não verificado: não afirme "${m[0]}"; use forma condicional.`);
      }
    }
  }
  if (ctx.site_status === "site_proprio_encontrado" && /(nao (tem|possui)|\bsem) (um |uma |o )?(site|pagina)/.test(n)) {
    out.push("O lead tem site próprio: não diga que não tem.");
  }
  if (LOST_CLIENTS.test(n)) out.push("Não afirme que perde clientes: não há prova disso.");
  for (const num of n.match(/\d+(?:[.,/:]\d+)*/g) ?? []) {
    if (!src.includes(num)) out.push(`O número "${num}" não está nos dados do lead.`);
  }
  if (/\b(estrelas|nota \d|avaliacoes)/.test(n) && !/(estrelas|avaliacoes|nota \d)/.test(src)) {
    out.push("Não cite nota ou avaliações que não estão nos dados.");
  }
  if (/concorr/.test(n) && !/concorr/.test(src)) out.push("Não cite concorrentes.");
  for (const [r, stem] of PROCEDURES) {
    if (r.test(n) && !src.includes(stem)) out.push(`Procedimento "${stem}" não aparece nos dados do lead.`);
  }

  // As três partes precisam vir dos dados e aparecer na mensagem.
  const names = words(`${ctx.business_name} ${ctx.responsible_name ?? ""} ${ctx.city ?? ""}`);
  const srcWords = words(src);
  const msgWords = words(text);
  const parts: [keyof OutreachPayload, string][] = [
    ["elogio", "o elogio"],
    ["dor", "a dor"],
    ["melhoria", "o ponto de melhoria"],
  ];
  for (const [key, label] of parts) {
    const w = words(p[key] ?? "");
    if (!(p[key] ?? "").trim()) {
      out.push(`Faltou ${label}.`);
      continue;
    }
    if (key !== "melhoria" && overlap(w, srcWords, names) < 2) out.push(`${label[0].toUpperCase()}${label.slice(1)} precisa vir das evidências ou do diagnóstico.`);
    if (overlap(w, msgWords) < 1) out.push(`A mensagem não usa ${label}.`);
  }
  return [...new Set(out)];
}
