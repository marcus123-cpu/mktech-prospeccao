// Regras da mensagem do envio automático (passo 2 do método em degraus:
// sinal percebido + uma pergunta de investigação). Funções puras: a API recusa o que o
// Hermes escreveu fora das regras (o lead é pulado e nada é enviado), e o
// painel usa as mesmas regras para mostrar o motivo.
//
// A mensagem chega ao cliente exatamente como foi salva aqui, então qualquer
// sinal de saída técnica do agente (erro, JSON, código, recusa do modelo)
// derruba a mensagem inteira.

import { googleConsultado, instagramConsultado, siteConhecido, type Estrategia } from "@/lib/prospeccao/estrategias";

// Mensagens curtas e claras, a pedido do Marcos.
export const MIN_CHARS = 100;
export const MAX_CHARS = 400;

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

export type OutreachPayload = {
  elogio: string;
  dor: string;
  melhoria: string;
  mensagem: string;
  /** Estratégia A/B/C. Sem ela, vale a regra antiga do passo 2 (pergunta sem falar do serviço). */
  estrategia?: Estrategia | null;
};

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
// "sistema" e "automação" são serviços da MKTech e podem aparecer; o que não
// pode é dizer que a própria mensagem é automática.
const AI = [
  /inteligencia artificial/, /\brobo\b/, /\bbot\b/, /\balgoritmo/, /chatgpt/, /\bgpt\b/, /\bhermes\b/, /\bcrm\b/,
  /(mensagem|resposta|envio) automatic/, /(gerad|enviad|escrit)[ao] automaticamente/, /\bagente\b/,
];
// Promessa de resultado que ninguém pode garantir.
const PROMISE = [
  /garant(o|imos|ido|ida|ia)/, /aumentar (o |seu |sua |os |as )?(faturamento|vendas|lucro)/, /dobrar|triplicar/,
  /(mais|novos) (clientes|pacientes) (todo|toda|por) (dia|semana|mes)/, /resultado (certo|garantido)/,
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
export type OutreachOptions = {
  /** Estilo "lendo a resposta": o texto responde ao que a pessoa escreveu, então pode começar com "Bom dia". */
  replying?: boolean;
};

export function validateOutreach(ctx: LeadContext, p: OutreachPayload, opts: OutreachOptions = {}): string[] {
  const out: string[] = [];
  const text = (p.mensagem ?? "").trim();
  const n = norm(text);
  const src = sourceText(ctx);
  const estrategia = p.estrategia ?? null;

  if (!ctx.diagnosis) out.push("Lead sem diagnóstico: não dá para escrever a mensagem.");
  if (text.length < MIN_CHARS) out.push(`Mensagem curta demais (mínimo ${MIN_CHARS} caracteres).`);
  if (text.length > MAX_CHARS) out.push(`Passou de ${MAX_CHARS} caracteres (${text.length}).`);
  if (!opts.replying && GREETING_START.test(n)) out.push("Não comece com saudação: o bom dia/boa noite é enviado antes, separado.");

  const all = norm([p.elogio, p.dor, p.melhoria, text].join("\n"));
  if (TECHNICAL.some((r) => r.test(all))) out.push("Tem texto técnico ou de erro; a mensagem não pode ter isso.");
  if (PRESSURE.some((r) => r.test(n))) out.push("Tem frase de pressão; tire.");
  if (PROMISE.some((r) => r.test(n))) out.push("Não prometa resultado (faturamento, clientes, garantia).");
  if (AI.some((r) => r.test(n)) || /\bI\.?A\b/.test(text)) out.push("Não mencione IA, sistema ou automação.");
  if (GENERIC_PRAISE.some((r) => r.test(n))) out.push("Elogio genérico; elogie algo concreto que aparece nas evidências.");
  if (/\b(prezad[ao]|vossa|\btu\b|\bteu\b|\btua\b)/.test(n)) out.push('Trate por "você".');
  if (/https?:|www\.|\.com\b|\.br\b/.test(n)) out.push("Não coloque links na primeira mensagem.");
  if (/r\$|\breais\b/.test(n)) out.push("Não cite preço.");
  if ((text.match(/\?/g) ?? []).length > 1) out.push("Use no máximo uma pergunta, no final.");
  if (/\?/.test(text) && /[a-zà-ú]{3,}/i.test(text.slice(text.lastIndexOf("?") + 1))) out.push("A pergunta precisa ficar no final.");
  if ((text.match(/\p{Extended_Pictographic}/gu) ?? []).length > 2) out.push("No máximo 2 emojis.");
  if (/[A-ZÀ-Ú]{6,}/.test(text)) out.push("Não escreva palavras em CAIXA ALTA.");

  // Só diz que viu o Instagram ou o Google quando a pesquisa consultou.
  if (/instagram|\binsta\b/.test(n) && !instagramConsultado(ctx)) {
    out.push("Não diga que viu o Instagram: a pesquisa não consultou o Instagram deste lead.");
  }
  if (/\bgoogle\b|\bmaps\b/.test(n) && !googleConsultado(ctx)) {
    out.push("Não diga que encontrou no Google: a pesquisa não tem evidência do Google para este lead.");
  }

  if (estrategia) out.push(...strategyRules(ctx, estrategia, text, n, !!opts.replying));
  else {
    if (!/\?\s*\p{Extended_Pictographic}?\s*$/u.test(text)) out.push("Termine com uma pergunta de investigação (como o cliente chega ou agenda).");
    // Método em degraus antigo: nesta mensagem ainda não se fala do que a MKTech faz.
    if (/\b(site|pagina|landing|polpuja|sistema|solucao)\b/.test(n)) {
      out.push("Não fale de site, página, sistema ou solução nesta mensagem: isso fica para depois que a pessoa responder.");
    }
  }

  // Sem site confirmado ausente, nunca afirme que a clínica não tem site.
  if (needsCaution(ctx) || siteConhecido(ctx) !== "nao_tem") {
    for (const r of ASSERTIVE) {
      const m = r.exec(n);
      if (m && !CONDITIONAL.test(n.slice(Math.max(0, m.index - 40), m.index))) {
        out.push(`Site não confirmado: não afirme "${m[0]}"; use forma condicional.`);
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
    if (r.test(n) && !src.includes(stem) && !r.test(src)) out.push(`Procedimento "${stem}" não aparece nos dados do lead.`);
  }

  // As três partes precisam vir dos dados. A dor e a melhoria ficam guardadas
  // para o passo seguinte; o fato verificado (elogio) aparece na mensagem na
  // regra antiga e na estratégia B (as estratégias A e C podem ser só transparentes).
  const names = words(`${ctx.business_name} ${ctx.responsible_name ?? ""} ${ctx.city ?? ""}`);
  const srcWords = words(src);
  const msgWords = words(text);
  const parts: [keyof Pick<OutreachPayload, "elogio" | "dor" | "melhoria">, string][] = [
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
    if (key === "elogio" && (!estrategia || estrategia === "B") && overlap(w, msgWords) < 1) out.push(`A mensagem não usa ${label}.`);
  }
  return [...new Set(out)];
}

/** Última frase (a pergunta do fim). */
function lastSentence(n: string): string {
  const parts = n.split(/(?<=[.!])\s+/);
  return parts[parts.length - 1] ?? n;
}

/** Regras próprias das estratégias A/B/C (a regra comum já rodou antes). */
function strategyRules(ctx: LeadContext, e: Estrategia, text: string, n: string, replying: boolean): string[] {
  const out: string[] = [];
  const ask = lastSentence(n);
  // Lendo a resposta: se quem respondeu é a recepção, a pergunta pode ser por
  // quem cuida dessa parte (chegar a quem decide vem antes da ideia).
  const askForOwner = replying && /\b(proprietaria|responsavel|quem cuida|dona|doutora|dra)\b/.test(ask);
  if (!/\?\s*\p{Extended_Pictographic}?\s*$/u.test(text)) out.push("Termine com uma pergunta curta.");
  // O problema da abordagem antiga: perguntar antes de dizer quem é e por quê.
  if (!/\bmarcos\b/.test(n)) out.push('Diga quem está falando ("Sou o Marcos").');
  if (!/mktech|desenvolv/.test(n)) out.push('Diga de onde fala ("da MKTech Dev" ou "sou desenvolvedor").');
  const motivo = /\b(site|sites|pagina|paginas|landing|solucoes digitais|desenvolv\w*|agendamento)\b/;
  if (!motivo.test(n)) out.push("Explique em uma frase com o que trabalha (páginas, sites, soluções digitais para clínicas).");
  if (/polpuja|portfolio/.test(n)) out.push("Não cite casos nem portfólio na primeira mensagem.");

  if (e === "A" && !askForOwner && !/\b(posso|poderia|pode|podemos)\b.*\b(mostrar|apresentar|explicar|contar)\b/.test(ask)) {
    out.push('Estratégia A termina pedindo licença para mostrar a ideia ("Posso te mostrar rapidinho?").');
  }
  if (e === "B") {
    if (!askForOwner && !/\b(hoje|voces|como)\b/.test(ask)) out.push("Estratégia B termina com uma pergunta simples sobre como a clínica trabalha hoje.");
    if (siteConhecido(ctx) !== "incerto" && /\b(tem|tem alguma|possuem|possui|usam|utilizam)\b.{0,40}\b(site|pagina)/.test(ask)) {
      out.push("A pesquisa já confirmou a situação do site: não pergunte se a clínica tem site ou página.");
    }
  }
  if (e === "C") {
    if (!askForOwner && !/\bvideo\b/.test(n)) out.push("Estratégia C oferece o vídeo curto.");
    if (!askForOwner && !/\b(posso|poderia|pode)\b.*\b(enviar|mandar)\b/.test(ask)) out.push('Estratégia C pede licença para enviar o vídeo ("Posso te enviar?").');
    if (/(assist|veja|olha) (o|este|esse) video/.test(n) && !/\?/.test(n)) out.push("Peça licença antes de mandar o vídeo.");
  }
  return out;
}

// Secretário: respostas da conversa depois da mensagem personalizada.
export const SECRETARY_MAX_CHARS = 600;

/** Problemas da resposta do secretário. Lista vazia = pode ir para a fila. */
export function validateSecretaryReply(texto: string): string[] {
  const out: string[] = [];
  const text = (texto ?? "").trim();
  const n = norm(text);
  if (!text) out.push("Resposta vazia.");
  if (text.length > SECRETARY_MAX_CHARS) out.push(`Passou de ${SECRETARY_MAX_CHARS} caracteres (${text.length}); seja curto como no WhatsApp.`);
  if (TECHNICAL.some((r) => r.test(n))) out.push("Tem texto técnico ou de erro; a resposta não pode ter isso.");
  if (PRESSURE.some((r) => r.test(n))) out.push("Tem frase de pressão; tire.");
  if (AI.some((r) => r.test(n)) || /\bI\.?A\b/.test(text)) out.push("Não mencione IA, robô ou automação; se perguntarem, passe para o Marcos.");
  if (/https?:|www\.|\.com\b|\.br\b|\.app\b/.test(n)) out.push("Não mande links.");
  if (/portfolio/.test(n)) out.push("Não ofereça portfólio.");
  if (/r\$|\breais\b|\b\d+\s*(mil|k)\b/.test(n)) out.push("Não cite valor: diga que já explica certinho e passe para o Marcos.");
  if (/\b(reuniao|call|videochamada|ligacao|ligar pra|te ligo)\b/.test(n)) out.push("Sem reunião nem ligação: tudo pelo WhatsApp.");
  if ((text.match(/\p{Extended_Pictographic}/gu) ?? []).length > 2) out.push("No máximo 2 emojis.");
  if (/[A-ZÀ-Ú]{6,}/.test(text)) out.push("Não escreva palavras em CAIXA ALTA.");
  if (/\bo marcos (vai|vai te|te) /.test(n)) out.push('Fale em primeira pessoa, como o Marcos ("já te explico"), nunca "o Marcos vai".');
  return [...new Set(out)];
}
