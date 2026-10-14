// Fluxo comercial em estados (prompt do Marcos, 13/10): quem respondeu, o que
// a resposta quer dizer e qual é o próximo passo. Funções puras, sem envio:
// o painel mostra a sugestão, o secretário segue as mesmas regras pela skill,
// e a API grava a classificação de cada resposta para as métricas A/B/C.

import { classifyReply, type ReplyInput } from "@/lib/envio/respostas";

export const ESTADOS = [
  "primeiro_contato",
  "resposta_recebida",
  "qualificacao",
  "video",
  "pos_video",
  "interesse",
  "negociacao",
  "oportunidade",
  "encerrado",
] as const;
export type Estado = (typeof ESTADOS)[number];

export const ESTADO_LABEL: Record<Estado, string> = {
  primeiro_contato: "1. Primeiro contato",
  resposta_recebida: "2. Resposta recebida",
  qualificacao: "3. Qualificação",
  video: "4. Apresentação do vídeo",
  pos_video: "5. Depois do vídeo",
  interesse: "6. Interesse comercial",
  negociacao: "7. Negociação",
  oportunidade: "8. Oportunidade qualificada",
  encerrado: "9. Encerrado",
};

/** Posição no funil (encerrado não avança o funil). */
export const ESTADO_RANK: Record<Estado, number> = {
  primeiro_contato: 1,
  resposta_recebida: 2,
  qualificacao: 3,
  video: 4,
  pos_video: 5,
  interesse: 6,
  negociacao: 7,
  oportunidade: 8,
  encerrado: 0,
};

export const PAPEIS = ["recepcionista", "proprietaria", "gerente", "marketing", "automatico", "desconhecido"] as const;
export type Papel = (typeof PAPEIS)[number];
export const PAPEL_LABEL: Record<Papel, string> = {
  recepcionista: "Recepcionista / secretária",
  proprietaria: "Proprietária / responsável",
  gerente: "Gerente",
  marketing: "Marketing",
  automatico: "Atendimento automático",
  desconhecido: "Ainda não identificado",
};
/** Quem pode avaliar e contratar. */
export const DECISORES: Papel[] = ["proprietaria", "gerente", "marketing"];

export const INTENCOES = ["positiva", "neutra", "negativa", "automatica", "esclarecimento", "encaminhamento"] as const;
export type Intencao = (typeof INTENCOES)[number];
export const INTENCAO_LABEL: Record<Intencao, string> = {
  positiva: "Positiva",
  neutra: "Neutra",
  negativa: "Negativa",
  automatica: "Automática",
  esclarecimento: "Pedido de esclarecimento",
  encaminhamento: "Encaminhamento",
};

export const INTERESSES = ["desconhecido", "nenhum", "baixo", "medio", "alto"] as const;
export type Interesse = (typeof INTERESSES)[number];
export const INTERESSE_LABEL: Record<Interesse, string> = {
  desconhecido: "Ainda não avaliado",
  nenhum: "Nenhum",
  baixo: "Baixo",
  medio: "Médio",
  alto: "Alto",
};

export type Objecao =
  | "ja_tem_site"
  | "sem_interesse"
  | "preco"
  | "manda_por_aqui"
  | "vai_falar_com_responsavel"
  | "nao_cuida_disso"
  | "pediu_para_parar";

export type Analise = {
  intencao: Intencao;
  papel: Papel;
  objecao: Objecao | null;
  /** A pessoa aceitou receber o vídeo (só vale se o vídeo foi oferecido). */
  aceitou: boolean;
  pediuParar: boolean;
  perguntouPreco: boolean;
  motivo: string;
};

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const STOP = [
  /\b(pare|parem|para de|parar de) (de )?(me |nos )?(mandar|enviar|chamar)/,
  /\bnao (me |nos )?(mande|mandem|envie|enviem|chame|chamem) mais\b/,
  /\b(remova|remover|tira|tire|exclua|excluir) (meu|o meu|nosso|esse|este) (numero|contato)/,
  /\b(descadastr|sair da lista)/,
  /^\s*(pare|parar|sair|stop)\s*[.!]*\s*$/,
  /\b(spam|denunciar|denuncia|bloquear|bloqueado)\b/,
];
const NO_INTEREST =
  /\bnao (?:estou|estamos|esta|estao|sou|somos) interessad[oa]s?\b|\bnao (?:tenho|temos) interesse\b|\bsem interesse\b|\bnao (?:quero|queremos|preciso|precisamos)\b|\b(agora|no momento) nao\b|^nao[,.!\s]*(?:obrigad[oa]s?[!.\s]*)?$/;
const HAS_SITE = /\bja (temos|tenho|possuimos|possuo|tem|existe)( um| o| nosso| uma)? (site|pagina|landing)|\bnosso site\b|\btemos (um )?site\b/;
const FORWARD_SELF = /\bvou (passar|encaminhar|repassar|mostrar|falar com|ver com|conversar com)\b|\b(ela|a doutora|a dra|a dona|a responsavel|a proprietaria|ele) (te )?(retorna|responde|vai ver|vai te chamar)/;
const NOT_ME = /\bnao sou eu (que|quem)( cuid\w*| decid\w*| resolv\w*)?|\bquem (cuida|decide|resolve) (disso |dessa parte )?(e|eh) (a|o)\b|\b(isso|essa parte) (e|eh) com (a|o)\b/;
const RECEPTION = [
  /\bsou (a |o )?(recepcionista|secretaria|secretario|atendente)\b/,
  /\baqui (e|eh) (a |da )?(recepcao|secretaria)\b/,
  /\b(a doutora|a dra|a dona|a responsavel|a proprietaria|ela) (nao esta|esta em atendimento|esta atendendo|esta ocupada|so volta)\b/,
  /\b(falar|fale|conversar) com a (dra|doutora|responsavel|proprietaria|dona)\b/,
];
const OWNER = [
  /\bsou (a |o )?(dona|dono|proprietaria|proprietario|responsavel|dra|doutora|biomedica|esteticista|fisioterapeuta|enfermeira|socia|socio)\b/,
  /\bsou eu (mesma|mesmo|que cuido|quem cuida|a responsavel|o responsavel)\b/,
  /\beu (mesma|mesmo) (cuido|atendo|faco|vejo)\b/,
  /\b(a )?(clinica|studio|estudio|espaco) (e|eh) (minha|meu)\b|\bmeu (studio|estudio|espaco|consultorio)\b/,
  /\beu que (cuido|decido|vejo)\b/,
];
const MANAGER = /\bsou (a |o )?(gerente|administradora?|coordenadora?)\b/;
const MARKETING = /\b(sou|cuido) (d[oa] |a |o )?(responsavel (pelo|do) )?(marketing|social media|redes sociais|midias)\b|\bagencia\b/;
const TRIAGE =
  /\b(quem (e|eh|fala|seria|gostaria)|do que se trata|qual (o |seria o )?assunto|sobre o que (seria|e)|em que (posso|podemos) (te |lhe )?ajudar|como (posso|podemos) (te |lhe )?ajudar|pois nao)\b/;
const QUESTION =
  /\b(como (assim|funciona|seria)|o que (seria|e isso|voce faz|voces fazem)|pode explicar|nao entendi|como conseguiu (meu|o|nosso) (numero|contato)|que ideia)\b/;
const SEND_HERE = /\b(manda|mande|envia|envie|pode mandar|pode enviar|me manda|me envia)( (sim|ai))? (por aqui|aqui|pelo whats\w*|no whats\w*)\b|\bpor aqui mesmo\b/;
const YES =
  /^(sim|pode|claro|quero|pode sim|manda|mande|mostra|mostre|pode mostrar|pode mandar|pode enviar|envia|envie|tenho interesse|temos interesse|gostaria|com certeza|ok|okay|pode ser|bora|vamos|quero ver|quero sim|adoraria|me mostra|mostra sim)\b/;
const LIKED = /\b(gostei|gostamos|adorei|amei|muito bom|muito boa|ficou (lindo|lindo|otimo|bom|show)|interessante|legal|show|top|faz sentido)\b/;
const WANTS_DEAL = /\b(como (faco|faz|fazemos) para (contratar|fechar|comecar)|quero fazer|vamos fazer|quero contratar|como funciona o pagamento|qual o prazo|quando (comeca|fica pronto))\b/;

/**
 * Lê uma resposta: intenção (6 tipos do prompt), quem respondeu e qual objeção
 * apareceu. `oferecido` diz se a nossa última mensagem ofereceu vídeo ou ideia.
 */
export function analisarResposta(input: ReplyInput & { oferecido?: boolean }): Analise {
  const base = classifyReply(input);
  const t = norm(input.texto ?? "");
  const r = (a: Partial<Analise> & Pick<Analise, "intencao" | "motivo">): Analise => ({
    papel: papelDe(t),
    objecao: null,
    aceitou: false,
    pediuParar: false,
    perguntouPreco: false,
    ...a,
  });
  if (base.kind === "automatica") return r({ intencao: "automatica", papel: "automatico", motivo: base.reason });
  if (STOP.some((x) => x.test(t))) {
    return r({ intencao: "negativa", objecao: "pediu_para_parar", pediuParar: true, motivo: "pediu para não receber mais mensagens" });
  }
  if (NO_INTEREST.test(t) && !YES.test(t)) return r({ intencao: "negativa", objecao: "sem_interesse", motivo: "disse que não tem interesse" });
  if (HAS_SITE.test(t)) return r({ intencao: "neutra", objecao: "ja_tem_site", motivo: "disse que já tem site" });
  if (NOT_ME.test(t)) return r({ intencao: "encaminhamento", objecao: "nao_cuida_disso", motivo: "disse que não é quem cuida disso" });
  if (FORWARD_SELF.test(t)) {
    return r({ intencao: "encaminhamento", objecao: "vai_falar_com_responsavel", motivo: "vai passar para outra pessoa ou pensar" });
  }
  if (base.asksPrice) return r({ intencao: "positiva", objecao: "preco", perguntouPreco: true, motivo: "perguntou o valor" });
  if (WANTS_DEAL.test(t)) return r({ intencao: "positiva", motivo: "quer saber como contratar" });
  if (SEND_HERE.test(t)) return r({ intencao: "positiva", objecao: "manda_por_aqui", aceitou: !!input.oferecido, motivo: "pediu para mandar por aqui" });
  if (YES.test(t) && !/\bnao\b/.test(t)) return r({ intencao: "positiva", aceitou: !!input.oferecido, motivo: "aceitou" });
  if (LIKED.test(t) && !/\bnao\b/.test(t)) return r({ intencao: "positiva", motivo: "gostou" });
  if (TRIAGE.test(t) || QUESTION.test(t)) return r({ intencao: "esclarecimento", motivo: "quer saber quem é ou do que se trata" });
  if (/\?\s*$/.test(t) && !/\btudo (bem|bom|otimo|joia)\b/.test(t)) return r({ intencao: "esclarecimento", motivo: "fez uma pergunta" });
  return r({ intencao: "neutra", motivo: "resposta sem sinal claro" });
}

/** Quem está escrevendo, pelo que a própria pessoa disse. */
export function papelDe(textoNorm: string): Papel {
  if (OWNER.some((x) => x.test(textoNorm))) return "proprietaria";
  if (MANAGER.test(textoNorm)) return "gerente";
  if (MARKETING.test(textoNorm)) return "marketing";
  if (RECEPTION.some((x) => x.test(textoNorm))) return "recepcionista";
  return "desconhecido";
}

// Respostas de referência para objeções e situações. O Hermes adapta ao lead;
// nenhuma cita preço, case ou promessa.
export const REFERENCIAS = {
  recepcionista_cumprimento:
    "Obrigado pelo retorno! Sou o Marcos, da MKTech Dev. Trabalho com soluções digitais para clínicas de estética. Gostaria de apresentar uma ideia para a clínica. Você saberia me dizer se é a proprietária quem cuida dessa parte ou se existe outra pessoa responsável?",
  recepcionista_pergunta:
    "Claro! Trabalho desenvolvendo páginas profissionais para clínicas de estética e queria apresentar uma sugestão para vocês. Seria possível conversar com a proprietária ou com quem cuida dessa parte digital?",
  recepcionista_encaminha: "Perfeito, muito obrigado! Posso te enviar uma apresentação curtinha para encaminhar à responsável?",
  nao_cuida_disso: "Entendi, obrigado! Você saberia me dizer qual o melhor canal ou momento para apresentar a ideia para quem cuida dessa parte?",
  responsavel:
    "Prazer! Trabalho desenvolvendo páginas que ajudam clínicas a apresentar seus procedimentos de forma mais organizada. Tenho um exemplo visual bem rápido. Posso te mostrar?",
  marketing:
    "Que bom falar com você! A ideia é uma página que soma ao que vocês já fazem no Instagram: procedimentos organizados e um caminho direto para agendar. Tenho um exemplo visual curto. Posso te mostrar?",
  ja_tem_site:
    "Ah, que bom que vocês já têm! E vocês estão satisfeitos com a forma como os procedimentos aparecem lá e com os contatos que chegam por ele?",
  sem_interesse: "Entendido, obrigado pelo retorno e pela atenção. Se um dia fizer sentido, fico à disposição.",
  pediu_para_parar: "Tudo certo, não vou mais te enviar mensagens. Obrigado pela atenção!",
  preco:
    "O valor depende do que fizer sentido para vocês, como quantos procedimentos entram e se tem agendamento. Já te explico certinho.",
  manda_por_aqui:
    "Claro! Em resumo: crio páginas para clínicas de estética, com os procedimentos organizados e um botão direto para agendar pelo WhatsApp. Tenho um vídeo curtinho mostrando como fica. Posso te mandar?",
  vai_falar_com_responsavel: "Claro, sem pressa nenhuma! Fico à disposição para qualquer dúvida.",
  video_aceito: "Ótimo! Já te mando o vídeo, é bem rápido.",
  pos_video:
    "Essa é a ideia! Uma página com a identidade da clínica, apresentando os procedimentos e facilitando o contato de quem quer agendar. Você acha que faria sentido algo assim para vocês?",
  pos_video_sem_sinal: "Quando conseguir dar uma olhada no vídeo, me conta o que achou?",
  interesse:
    "Que bom que gostou! Posso montar uma proposta pensada para a clínica de vocês, com os procedimentos que vocês mais divulgam. Faz sentido para você?",
} as const;

export type Passo = {
  /** Estado depois desta resposta. */
  estado: Estado;
  /** Objetivo da próxima mensagem, em uma frase. */
  objetivo: string;
  /** O que fazer agora (para o Marcos ou o secretário). */
  acao: string;
  /** Texto de referência; adaptar, nunca copiar sem ler a conversa. */
  referencia: string | null;
  /** Motivo para passar a conversa ao Marcos, quando ele precisa assumir. */
  passarParaMarcos: string | null;
  /** Marcar no CRM. */
  registrar: { videoOferecido?: boolean; videoAutorizado?: boolean; interesse?: Interesse; acompanhamentoDias?: number };
};

export type SituacaoLead = {
  estado: Estado | null;
  papel: Papel | null;
  videoOferecidoEm?: string | null;
  videoEnviadoEm?: string | null;
};

/** Próximo passo depois de uma resposta. Nunca avança sozinho para venda. */
export function proximoPasso(lead: SituacaoLead, a: Analise): Passo {
  const papel: Papel = a.papel !== "desconhecido" && a.papel !== "automatico" ? a.papel : (lead.papel ?? "desconhecido");
  const estadoAtual: Estado = lead.estado ?? "primeiro_contato";
  const videoEnviado = !!lead.videoEnviadoEm;
  const videoOferecido = !!lead.videoOferecidoEm;
  const passo = (p: Partial<Passo> & Pick<Passo, "estado" | "objetivo" | "acao">): Passo => ({
    referencia: null,
    passarParaMarcos: null,
    registrar: {},
    ...p,
  });
  const avancar = (e: Estado): Estado => (ESTADO_RANK[e] >= ESTADO_RANK[estadoAtual] ? e : estadoAtual);

  if (a.pediuParar) {
    return passo({
      estado: "encerrado",
      objetivo: "Respeitar o pedido.",
      acao: "Confirmar em uma frase que não vai mais mandar mensagens e encerrar. Não insistir nem oferecer nada.",
      referencia: REFERENCIAS.pediu_para_parar,
      registrar: { interesse: "nenhum" },
    });
  }
  if (a.intencao === "automatica") {
    return passo({
      estado: estadoAtual,
      objetivo: "Esperar uma pessoa.",
      acao: "Resposta automática não é interesse. Não responder; aguardar uma pessoa escrever.",
    });
  }
  if (a.objecao === "sem_interesse") {
    return passo({
      estado: "encerrado",
      objetivo: "Encerrar com educação.",
      acao: "Agradecer e encerrar. Não insistir nem oferecer outra coisa.",
      referencia: REFERENCIAS.sem_interesse,
      registrar: { interesse: "nenhum" },
    });
  }
  if (a.objecao === "preco") {
    return passo({
      estado: avancar("negociacao"),
      objetivo: "Explicar que o valor depende do escopo, sem inventar número.",
      acao: "Responder que o valor depende do que fizer sentido e passar para o Marcos montar a proposta.",
      referencia: REFERENCIAS.preco,
      passarParaMarcos: "perguntou o valor",
      registrar: { interesse: "alto" },
    });
  }
  if (a.objecao === "ja_tem_site") {
    return passo({
      estado: avancar("qualificacao"),
      objetivo: "Descobrir se existe oportunidade real, sem criticar o site.",
      acao: "Reconhecer o site e perguntar se estão satisfeitos com a apresentação dos procedimentos e com os contatos. Se estiverem, agradecer e encerrar.",
      referencia: REFERENCIAS.ja_tem_site,
    });
  }
  if (a.objecao === "nao_cuida_disso") {
    return passo({
      estado: avancar("resposta_recebida"),
      objetivo: "Chegar a quem decide, sem pedir contato pessoal.",
      acao: "Perguntar com educação qual o melhor canal ou momento para falar com quem cuida disso.",
      referencia: REFERENCIAS.nao_cuida_disso,
    });
  }
  if (a.objecao === "vai_falar_com_responsavel") {
    if (papel === "recepcionista" || papel === "desconhecido") {
      return passo({
        estado: avancar("resposta_recebida"),
        objetivo: "Fazer a apresentação chegar à responsável.",
        acao: "Agradecer e oferecer um material curto para ela encaminhar. Sem pressionar.",
        referencia: REFERENCIAS.recepcionista_encaminha,
        registrar: { acompanhamentoDias: 3 },
      });
    }
    return passo({
      estado: estadoAtual,
      objetivo: "Dar espaço.",
      acao: "Dizer que fica à disposição e combinar um único retorno curto em alguns dias.",
      referencia: REFERENCIAS.vai_falar_com_responsavel,
      registrar: { acompanhamentoDias: 6 },
    });
  }
  if (a.objecao === "manda_por_aqui") {
    if (videoOferecido && !videoEnviado) {
      return passo({
        estado: avancar("video"),
        objetivo: "Mandar o material autorizado, uma vez só.",
        acao: "Ela autorizou: o Marcos manda o vídeo com uma frase curta.",
        referencia: REFERENCIAS.video_aceito,
        passarParaMarcos: "autorizou o vídeo",
        registrar: { videoAutorizado: true, interesse: "medio" },
      });
    }
    return passo({
      estado: avancar("video"),
      objetivo: "Explicar em duas frases e oferecer o vídeo.",
      acao: "Resumo curto do que faz e pedir licença para mandar o vídeo, sem textão.",
      referencia: videoEnviado ? null : REFERENCIAS.manda_por_aqui,
      registrar: videoEnviado ? {} : { videoOferecido: true },
    });
  }

  // Depois do vídeo: opinião antes de qualquer proposta. "Ok" ou "sim" soltos
  // não dizem que ela assistiu nem que gostou.
  if (videoEnviado && ESTADO_RANK[estadoAtual] >= ESTADO_RANK.video) {
    const gostou = a.intencao === "positiva" && a.motivo !== "aceitou";
    if (/quer saber como contratar/.test(a.motivo)) {
      return passo({
        estado: "oportunidade",
        objetivo: "Passar para o Marcos fechar.",
        acao: "Oportunidade qualificada: o Marcos assume a negociação.",
        passarParaMarcos: "quer contratar",
        registrar: { interesse: "alto" },
      });
    }
    // Em pos_video já perguntamos "faria sentido?": um "sim" responde isso.
    if (a.intencao === "positiva" && estadoAtual === "pos_video") {
      return passo({
        estado: "interesse",
        objetivo: "Confirmar o interesse e oferecer uma proposta pensada para a clínica.",
        acao: "Oferecer a proposta sem citar valor; se ela topar, passar para o Marcos.",
        referencia: REFERENCIAS.interesse,
        passarParaMarcos: "gostou da ideia",
        registrar: { interesse: "alto" },
      });
    }
    if (gostou) {
      return passo({
        estado: "pos_video",
        objetivo: "Pedir a opinião e o próximo passo.",
        acao: "Perguntar se faria sentido para a clínica.",
        referencia: REFERENCIAS.pos_video,
        registrar: { interesse: "medio" },
      });
    }
    return passo({
      estado: "pos_video",
      objetivo: "Não presumir que o vídeo foi assistido.",
      acao: "Perguntar com leveza o que achou quando der para ver. Não reenviar o vídeo.",
      referencia: REFERENCIAS.pos_video_sem_sinal,
    });
  }

  if (/quer saber como contratar/.test(a.motivo)) {
    return passo({
      estado: "oportunidade",
      objetivo: "Passar para o Marcos.",
      acao: "Ela quer saber como contratar: o Marcos assume.",
      passarParaMarcos: "quer contratar",
      registrar: { interesse: "alto" },
    });
  }
  if (a.intencao === "positiva" && videoOferecido && !videoEnviado) {
    return passo({
      estado: avancar("video"),
      objetivo: "Mandar o vídeo autorizado, uma vez só.",
      acao: "Ela aceitou: o Marcos manda o vídeo.",
      referencia: REFERENCIAS.video_aceito,
      passarParaMarcos: "autorizou o vídeo",
      registrar: { videoAutorizado: true, interesse: "medio" },
    });
  }

  // Ainda chegando a quem decide.
  if (papel === "recepcionista" || (papel === "desconhecido" && a.intencao === "esclarecimento")) {
    return passo({
      estado: avancar("resposta_recebida"),
      objetivo: "Descobrir quem cuida da parte digital, sem apresentação longa.",
      acao:
        a.intencao === "esclarecimento"
          ? "Dizer em uma frase o que faz e perguntar se dá para falar com a proprietária ou com quem cuida disso."
          : "Agradecer, dizer quem é e perguntar quem cuida dessa parte. Não pressupor que ela não decide.",
      referencia: a.intencao === "esclarecimento" ? REFERENCIAS.recepcionista_pergunta : REFERENCIAS.recepcionista_cumprimento,
    });
  }
  if (DECISORES.includes(papel) && !videoEnviado) {
    return passo({
      estado: avancar("qualificacao"),
      objetivo: "Apresentar a oportunidade em uma frase e oferecer a demonstração.",
      acao: "Conversa direta com quem decide: frase curta do que faz e pedir licença para mostrar o exemplo visual.",
      referencia: papel === "marketing" ? REFERENCIAS.marketing : REFERENCIAS.responsavel,
      registrar: { videoOferecido: true },
    });
  }
  if (a.intencao === "positiva") {
    return passo({
      estado: avancar("qualificacao"),
      objetivo: "Confirmar com quem está falando antes de apresentar.",
      acao: "Agradecer e oferecer o exemplo visual; se for a recepção, perguntar quem cuida disso.",
      referencia: REFERENCIAS.responsavel,
      registrar: { videoOferecido: true },
    });
  }
  return passo({
    estado: avancar("resposta_recebida"),
    objetivo: "Seguir a estratégia escolhida.",
    acao:
      estadoAtual === "primeiro_contato"
        ? "Ela respondeu a saudação: a mensagem da estratégia A/B/C é a próxima."
        : "Responder o que ela disse em uma frase e fazer no máximo uma pergunta.",
  });
}
