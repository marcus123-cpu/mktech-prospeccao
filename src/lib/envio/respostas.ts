// Classifica a resposta que chegou depois da abordagem automática:
// "automatica" (mensagem de ausência / boas-vindas do WhatsApp Business, menu
// de opções, aviso de horário) ou "humana" (uma pessoa escreveu). Resposta
// automática nunca é tratada como conversa: o lead continua como está.
// Na dúvida, fica "humana", porque perder uma pessoa custa mais caro.

export type ReplyKind = "automatica" | "humana";

export type ReplyInput = {
  texto: string;
  /** Tipo da mensagem recebida. Áudio é sempre de pessoa. */
  tipo?: "texto" | "audio" | "imagem" | "outro";
  /** Segundos entre a nossa última mensagem e esta resposta, se o enviador souber. */
  segundos_desde_envio?: number | null;
  /** Respostas anteriores do mesmo telefone (para pegar texto repetido). */
  anteriores?: string[];
};

export type ReplyClass = { kind: ReplyKind; reason: string; optOut: boolean; asksPrice: boolean };

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const AUTO_PATTERNS: [RegExp, string][] = [
  [/mensagem automatica|resposta automatica|atendimento automatico/, "diz que é automática"],
  [/obrigad[oa] (por|pelo) (entrar em )?(seu |o )?contato|agradecemos (o |seu |pelo )?(seu )?contato/, "agradecimento padrão pelo contato"],
  [/(no momento|neste momento|agora) (nao|nao estamos|estamos (ausentes|indisponiveis|fora))/, "aviso de ausência"],
  [/(estamos|estou) (ausente|fora do (escritorio|horario)|indisponivel)/, "aviso de ausência"],
  [/fora do (nosso )?horario( de atendimento)?/, "aviso de horário"],
  [/(nosso )?horario de (atendimento|funcionamento)( e)?:?/, "aviso de horário"],
  [/(retornaremos|responderemos|entraremos em contato|retornarei|responderei)( (o mais breve|em breve|assim que))?/, "promete retorno"],
  [/em breve (retornaremos|responderemos|entraremos|um de nossos|nossa equipe|alguem)/, "promete retorno"],
  [/(digite|responda com|envie) (o numero|a opcao|uma opcao|\d)/, "menu de opções"],
  [/(escolha|selecione) (uma|a) (das )?opc/, "menu de opções"],
  [/^\s*\d\s*[-.)]\s*\w+.*\n?\s*\d\s*[-.)]/m, "menu numerado"],
  [/seja (muito )?bem[- ]?vind[oa]/, "boas-vindas padrão"],
  [/(como|em que) (podemos|posso) (te |lhe )?ajudar\??$/, "boas-vindas padrão"],
  [/(aguarde|por favor aguarde) (um momento|que|enquanto|nosso)/, "pede para aguardar"],
  [/(deixe|envie) sua mensagem/, "pede para deixar mensagem"],
  [/(acesse|confira|veja) (nosso|o nosso) (catalogo|cardapio|site|instagram)|wa\.me\/c\//, "envia catálogo/link"],
];

// Pedido para não receber mais mensagens (vale sempre, LGPD).
const OPT_OUT = [
  /\b(pare|parem|para de|parar de) (de )?(me )?(mandar|enviar|chamar)/,
  /\bnao (me )?(mande|mandem|envie|enviem|chame|chamem) mais\b/,
  /\b(remova|remover|tira|tire|exclua|excluir) (meu|o meu|esse|este) (numero|contato)/,
  /\bnao (tenho|temos) interesse\b/,
  /\bnao quero\b/,
  /\b(descadastr|sair da lista)/,
  /^\s*(pare|parar|sair|stop)\s*[.!]*\s*$/,
  /\b(spam|denunciar|denuncia|bloquear|bloqueado)\b/,
];

// Pessoa perguntando preço: o lead vai para "Pergunta de valor" no funil.
const PRICE = [
  /\bquanto (custa|custaria|fica|ficaria|sai|sairia|cobra|cobram|e|seria|vale|voce cobra)\b/,
  /\b(qual|quais) (o|e o|seria o|sao os|os)? ?(valor|valores|preco|precos|investimento)\b/,
  /\b(valor|valores|preco|precos|orcamento|investimento|tabela de precos?)\b/,
  /r\$/,
];

export function classifyReply(input: ReplyInput): ReplyClass {
  if (input.tipo === "audio") {
    return { kind: "humana", reason: "mandou áudio: mude o estilo da conversa", optOut: false, asksPrice: false };
  }
  const text = norm(input.texto ?? "");
  // Evento sem texto (aviso do WhatsApp, protocolo): não é uma pessoa escrevendo.
  if (input.tipo === "outro" && (text === "" || text === "[mensagem sem texto]")) {
    return { kind: "automatica", reason: "evento sem texto, não é uma pessoa", optOut: false, asksPrice: false };
  }
  const optOut = OPT_OUT.some((r) => r.test(text));
  if (optOut) return { kind: "humana", reason: "pediu para não receber mais mensagens", optOut: true, asksPrice: false };

  const reasons: string[] = [];
  let score = 0;
  for (const [r, why] of AUTO_PATTERNS) {
    if (r.test(text)) {
      score += 2;
      if (!reasons.includes(why)) reasons.push(why);
    }
  }
  const secs = input.segundos_desde_envio;
  if (typeof secs === "number" && secs >= 0 && secs <= 8 && text.length > 40) {
    score += 2;
    reasons.push(`chegou ${Math.round(secs)}s depois do envio, rápido demais para alguém digitar`);
  }
  if ((input.anteriores ?? []).some((a) => norm(a) === text && text.length > 20)) {
    score += 3;
    reasons.push("texto idêntico a uma resposta anterior");
  }
  if (text.length > 220) score += 1;
  // Resposta curta e com cara de pessoa pesa contra.
  if (text.length <= 60 && /\b(quem|qual|sim|pode|claro|oi|ola|bom dia|boa tarde|boa noite|tudo|obrigad|nao)\b/.test(text)) {
    score -= 1;
  }

  if (score >= 2) {
    return { kind: "automatica", reason: reasons.join("; ") || "padrão de mensagem automática", optOut: false, asksPrice: false };
  }
  const asksPrice = PRICE.some((r) => r.test(text));
  return {
    kind: "humana",
    reason: asksPrice ? "pessoa perguntando valor" : "texto escrito por uma pessoa",
    optOut: false,
    asksPrice,
  };
}
