// Três estratégias de primeira mensagem (A direta, B consultiva, C vídeo), a
// pedido do Marcos (13/10). Os textos de referência mostram o tom; o Hermes
// escreve a mensagem de cada lead a partir dos fatos verificados dele.
//
// A saudação ("Boa tarde, tudo bem?") continua saindo antes, separada, e o
// texto da estratégia só sai depois que uma pessoa responder. Por isso as
// referências começam já na apresentação.
//
// Teste A/B/C: os 30 primeiros leads com estratégia são distribuídos 10/10/10,
// equilibrando leads parecidos (mesmo "estrato") entre os grupos. Depois disso,
// vale a recomendação pelo perfil do lead. Nada aqui declara vencedora.

import type { LeadContext } from "@/lib/envio/mensagem";

export type Estrategia = "A" | "B" | "C";
export const ESTRATEGIAS_LISTA: Estrategia[] = ["A", "B", "C"];

/** Leads por estratégia na fase de teste exploratório. */
export const TESTE_POR_ESTRATEGIA = 10;

export const ESTRATEGIAS: Record<
  Estrategia,
  { nome: string; objetivo: string; quando: string; referencia: string }
> = {
  A: {
    nome: "Direta e profissional",
    objetivo: "Dizer quem é, por que escreveu e pedir licença para mostrar uma ideia.",
    quando: "Poucos dados públicos, site próprio não identificado ou contato comercial geral.",
    referencia:
      "Sou o Marcos, da MKTech Dev. Conheci a clínica de vocês pelo Instagram e trabalho com soluções digitais para clínicas de estética. Tive uma ideia que pode ajudar a apresentar melhor os tratamentos de vocês na internet. Posso te mostrar rapidinho?",
  },
  B: {
    nome: "Consultiva e personalizada",
    objetivo: "Abrir conversa sobre a presença digital com uma pergunta simples, depois de dizer quem é.",
    quando: "Instagram ou Google consultados e dados suficientes para uma abordagem contextualizada.",
    referencia:
      "Me chamo Marcos, sou desenvolvedor. Estava conhecendo o Instagram de vocês e vi o trabalho que realizam com estética. Queria saber uma coisa: hoje vocês têm alguma página própria para apresentar os procedimentos ou utilizam mais o Instagram e o WhatsApp?",
  },
  C: {
    nome: "Curiosidade e vídeo",
    objetivo: "Oferecer o vídeo curto que mostra como uma página ajuda a clínica, pedindo licença para enviar.",
    quando: "Sem página profissional identificada; lead que se beneficia de ver em vez de ler.",
    referencia:
      "Sou o Marcos, da MKTech Dev. Trabalho criando páginas profissionais para clínicas de estética. Preparei um vídeo curtinho mostrando como uma clínica pode organizar seus tratamentos e facilitar o contato com novos clientes, sem depender apenas do Instagram. Posso te enviar para dar uma olhada?",
  },
};

export type SiteConhecido = "tem" | "nao_tem" | "incerto";

export type PerfilLead = {
  instagramConsultado: boolean;
  googleConsultado: boolean;
  site: SiteConhecido;
  dados: "ricos" | "poucos";
  /** Grupo de leads parecidos, usado para equilibrar o teste. */
  estrato: string;
};

const has = (s: string | null | undefined, r: RegExp) => !!s && r.test(s.toLowerCase());

/**
 * Instagram realmente consultado: evidência do Instagram ou presença digital do
 * diagnóstico citando o perfil. Só o @ cadastrado não basta.
 */
export function instagramConsultado(ctx: LeadContext): boolean {
  return (
    has(ctx.diagnosis?.digital_presence, /instagram/) ||
    (ctx.evidences ?? []).some((e) => e.kind === "instagram" || has(e.url, /instagram\.com/) || has(e.summary, /instagram/))
  );
}

export function googleConsultado(ctx: LeadContext): boolean {
  return (
    has(ctx.diagnosis?.digital_presence, /google|maps/) ||
    (ctx.evidences ?? []).some((e) => e.kind === "google" || has(e.url, /google\.|goo\.gl|maps\./) || has(e.summary, /google|maps/))
  );
}

/**
 * O que a pesquisa confirmou sobre o site. "nao_tem" só quando a pesquisa viu as
 * redes e nenhum site, com confiança média ou alta; "site não localizado" não é
 * confirmação.
 */
export function siteConhecido(ctx: LeadContext): SiteConhecido {
  if (ctx.site_status === "site_proprio_encontrado" || ctx.website_url) return "tem";
  const conf = ctx.diagnosis?.confidence;
  if (ctx.site_status === "apenas_redes_sociais" && conf && conf !== "baixa") return "nao_tem";
  return "incerto";
}

export function perfilDoLead(ctx: LeadContext): PerfilLead {
  const ig = instagramConsultado(ctx);
  const gg = googleConsultado(ctx);
  const conf = ctx.diagnosis?.confidence;
  const ricos = (conf === "alta" || conf === "media") && (ctx.evidences ?? []).length >= 2;
  const dados = ricos ? "ricos" : "poucos";
  return {
    instagramConsultado: ig,
    googleConsultado: gg,
    site: siteConhecido(ctx),
    dados,
    estrato: `${dados}-${ig ? "instagram" : "sem_instagram"}`,
  };
}

/** Estratégias que fazem sentido para o lead, com o motivo de cada exclusão. */
export function estrategiasPermitidas(ctx: LeadContext): { permitidas: Estrategia[]; excluidas: Partial<Record<Estrategia, string>> } {
  const p = perfilDoLead(ctx);
  const excluidas: Partial<Record<Estrategia, string>> = {};
  if (!(p.instagramConsultado || p.googleConsultado) || p.dados === "poucos") {
    excluidas.B = "a consultiva precisa de Instagram ou Google consultados e dados suficientes";
  }
  if (p.site === "tem") excluidas.C = "a clínica tem site próprio; o vídeo parte de quem ainda não tem página";
  return { permitidas: ESTRATEGIAS_LISTA.filter((e) => !excluidas[e]), excluidas };
}

/** Quantos leads já receberam cada estratégia (mensagens não canceladas). */
export type Contagem = { estrategia: Estrategia; estrato: string | null; n: number };

export type Sugestao = {
  estrategia: Estrategia;
  modo: "teste" | "recomendada";
  estrato: string;
  motivo: string;
};

function total(c: Contagem[], e: Estrategia, estrato?: string) {
  return c.filter((x) => x.estrategia === e && (estrato === undefined || x.estrato === estrato)).reduce((s, x) => s + x.n, 0);
}

/** Recomendação pelo perfil, fora do teste. */
export function recomendarPorPerfil(ctx: LeadContext): { estrategia: Estrategia; motivo: string } {
  const p = perfilDoLead(ctx);
  const { permitidas } = estrategiasPermitidas(ctx);
  if (p.dados === "poucos") return { estrategia: "A", motivo: "poucos dados públicos: mensagem transparente e objetiva" };
  if (p.site === "nao_tem" && permitidas.includes("C")) {
    return { estrategia: "C", motivo: "a pesquisa viu só redes sociais: o vídeo mostra o que falta sem precisar explicar" };
  }
  if (permitidas.includes("B")) {
    return {
      estrategia: "B",
      motivo: `${p.instagramConsultado ? "Instagram" : "Google"} consultado e dados suficientes: dá para abrir uma conversa sobre como trabalham`,
    };
  }
  return { estrategia: "A", motivo: "abordagem direta é a mais segura para este perfil" };
}

/**
 * Escolhe a estratégia do próximo lead. Na fase de teste, a que tem menos leads
 * no mesmo estrato (e, empatando, no total), entre as permitidas que ainda não
 * chegaram a 10. `contagens` é atualizado para que um lote de leads saia equilibrado.
 */
export function sugerirEstrategia(ctx: LeadContext, contagens: Contagem[]): Sugestao {
  const p = perfilDoLead(ctx);
  const { permitidas } = estrategiasPermitidas(ctx);
  const abertas = permitidas.filter((e) => total(contagens, e) < TESTE_POR_ESTRATEGIA);
  let s: Sugestao;
  if (abertas.length) {
    const escolhida = [...abertas].sort(
      (a, b) =>
        total(contagens, a, p.estrato) - total(contagens, b, p.estrato) ||
        total(contagens, a) - total(contagens, b) ||
        a.localeCompare(b),
    )[0];
    s = {
      estrategia: escolhida,
      modo: "teste",
      estrato: p.estrato,
      motivo: `teste A/B/C: ${ESTRATEGIAS[escolhida].nome.toLowerCase()} tem menos leads parecidos com este (${p.estrato})`,
    };
  } else {
    const r = recomendarPorPerfil(ctx);
    s = { ...r, modo: "recomendada", estrato: p.estrato };
  }
  const linha = contagens.find((x) => x.estrategia === s.estrategia && x.estrato === p.estrato);
  if (linha) linha.n += 1;
  else contagens.push({ estrategia: s.estrategia, estrato: p.estrato, n: 1 });
  return s;
}
