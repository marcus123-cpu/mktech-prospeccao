import { describe, expect, it } from "vitest";
import { validateOutreach, type LeadContext, type OutreachPayload } from "@/lib/envio/mensagem";
import { analisarResposta, proximoPasso, REFERENCIAS } from "@/lib/prospeccao/conversa";
import {
  ESTRATEGIAS,
  estrategiasPermitidas,
  perfilDoLead,
  recomendarPorPerfil,
  sugerirEstrategia,
  type Contagem,
} from "@/lib/prospeccao/estrategias";
import { leituraDoTeste, taxa, type LinhaMetricas } from "@/lib/prospeccao/metricas";

// Lead com Instagram consultado e dados suficientes.
const rico: LeadContext = {
  business_name: "Studio Lírio Estética",
  city: "Bauru",
  site_status: "site_nao_localizado",
  services: ["limpeza de pele", "harmonização facial"],
  instagram_handle: "studiolirio",
  diagnosis: {
    confidence: "media",
    summary: "Estúdio de estética facial com agenda pelo WhatsApp.",
    digital_presence: "Instagram com posts semanais de limpeza de pele; 4,9 no Google com 64 avaliações.",
    pains: [{ pain: "Agendamento só pelo WhatsApp", evidence: "Bio do Instagram: agende pelo WhatsApp" }],
    opportunities: ["Página de limpeza de pele com agendamento"],
    offer: "landing_por_procedimento",
  },
  evidences: [
    { kind: "instagram", url: "https://instagram.com/studiolirio", summary: "Posts semanais de limpeza de pele, bio com WhatsApp" },
    { kind: "google", summary: "4,9 no Google com 64 avaliações" },
  ],
};

// Falta de informações públicas: só uma busca, confiança baixa, sem Instagram.
const pobre: LeadContext = {
  business_name: "Espaço Bem Estar",
  city: "Marília",
  site_status: "verificacao_pendente",
  diagnosis: {
    confidence: "baixa",
    summary: "Espaço de estética com telefone em diretório; poucas informações públicas.",
    pains: [{ pain: "Pouca presença digital", evidence: "Só aparece em diretório com telefone" }],
    opportunities: ["Página simples de apresentação"],
    offer: "landing_page",
  },
  evidences: [{ kind: "diretorio", summary: "Diretório local com telefone e categoria estética" }],
};

// Cliente com site existente.
const comSite: LeadContext = { ...rico, site_status: "site_proprio_encontrado", website_url: "https://studiolirio.com.br" };

const base = (mensagem: string, estrategia: "A" | "B" | "C"): OutreachPayload => ({
  elogio: "posts semanais de limpeza de pele no Instagram",
  dor: "agendamento só pelo WhatsApp",
  melhoria: "página de limpeza de pele com agendamento",
  mensagem,
  estrategia,
});

describe("primeira abordagem (estratégias A/B/C)", () => {
  const a =
    "Sou o Marcos, da MKTech Dev. Conheci o Studio Lírio pelo Instagram e trabalho com soluções digitais para clínicas de estética. Tive uma ideia que pode ajudar a apresentar melhor os tratamentos de vocês na internet. Posso te mostrar rapidinho?";
  const b =
    "Me chamo Marcos, sou desenvolvedor. Estava conhecendo o Instagram de vocês e vi os posts semanais de limpeza de pele. Queria saber uma coisa: hoje vocês têm alguma página própria para apresentar os procedimentos ou usam mais o Instagram e o WhatsApp?";
  const c =
    "Sou o Marcos, da MKTech Dev. Trabalho criando páginas profissionais para clínicas de estética. Preparei um vídeo curtinho mostrando como uma clínica pode organizar seus tratamentos e facilitar o contato, sem depender só do Instagram. Posso te enviar para dar uma olhada?";

  it("aceita as três estratégias escritas para o lead", () => {
    expect(validateOutreach(rico, base(a, "A"))).toEqual([]);
    expect(validateOutreach(rico, base(b, "B"))).toEqual([]);
    expect(validateOutreach(rico, base(c, "C"))).toEqual([]);
  });

  it("recusa a pergunta antes de dizer quem é e por quê (problema da abordagem antiga)", () => {
    const antiga =
      "Encontrei a clínica pelo Google e também dei uma olhada no Instagram de vocês. Hoje, os novos clientes costumam encontrar vocês mais pelo Instagram ou pelo Google?";
    const errors = validateOutreach(rico, base(antiga, "B")).join(" ");
    expect(errors).toMatch(/quem está falando/);
    expect(errors).toMatch(/com o que trabalha|de onde fala/);
  });

  it("A pede licença para mostrar; C oferece o vídeo e pede licença para enviar", () => {
    expect(validateOutreach(rico, base(a.replace("Posso te mostrar rapidinho?", "Vou te mandar agora."), "A")).join(" ")).toMatch(/licença|pergunta/);
    expect(validateOutreach(rico, base(c.replace("vídeo curtinho", "material curtinho"), "C")).join(" ")).toMatch(/vídeo/);
  });

  it("não promete resultado nem cita preço", () => {
    const m = a.replace("Tive uma ideia que pode ajudar", "Garanto que vou aumentar o faturamento e ajudar");
    expect(validateOutreach(rico, base(m, "A")).join(" ")).toMatch(/prometa/);
  });

  it("é a mensagem depois da saudação: não começa com bom dia", () => {
    expect(validateOutreach(rico, base(`Olá, boa tarde! Tudo bem? ${a}`, "A")).join(" ")).toMatch(/saudação/);
  });
});

describe("falta de informações públicas", () => {
  it("só A ou C; B (consultiva) fica de fora", () => {
    const { permitidas, excluidas } = estrategiasPermitidas(pobre);
    expect(permitidas).toEqual(["A", "C"]);
    expect(excluidas.B).toMatch(/consultiva/);
    expect(recomendarPorPerfil(pobre).estrategia).toBe("A");
  });

  it("não deixa dizer que viu o Instagram nem afirmar que não tem site", () => {
    const m =
      "Sou o Marcos, da MKTech Dev. Vi o Instagram de vocês e percebi que vocês não têm site. Trabalho com páginas para clínicas de estética. Posso te mostrar uma ideia rapidinho?";
    const errors = validateOutreach(pobre, {
      elogio: "diretório local com telefone e categoria estética",
      dor: "pouca presença digital em diretório",
      melhoria: "página simples",
      mensagem: m,
      estrategia: "A",
    }).join(" ");
    expect(errors).toMatch(/Instagram/);
    expect(errors).toMatch(/não afirme/);
  });

  it("aceita a mensagem transparente e objetiva", () => {
    const m =
      "Sou o Marcos, da MKTech Dev. Trabalho com soluções digitais para clínicas de estética aqui da região. Tive uma ideia que pode ajudar a apresentar melhor os tratamentos de vocês na internet. Posso te mostrar rapidinho?";
    expect(
      validateOutreach(pobre, {
        elogio: "diretório local com telefone e categoria estética",
        dor: "pouca presença digital em diretório",
        melhoria: "página simples",
        mensagem: m,
        estrategia: "A",
      }),
    ).toEqual([]);
  });
});

describe("cliente com site existente", () => {
  it("não usa C (vídeo para quem não tem página) e não pergunta se tem site", () => {
    expect(estrategiasPermitidas(comSite).permitidas).not.toContain("C");
    const b =
      "Me chamo Marcos, sou desenvolvedor. Estava conhecendo o Instagram de vocês e vi os posts semanais de limpeza de pele. Queria saber uma coisa: hoje vocês têm alguma página própria para apresentar os procedimentos?";
    expect(validateOutreach(comSite, base(b, "B")).join(" ")).toMatch(/não pergunte se a clínica tem site/);
  });

  it("'Já temos site' vira qualificação sem criticar o site", () => {
    const a = analisarResposta({ texto: "Já temos site, obrigada" });
    expect(a.objecao).toBe("ja_tem_site");
    const p = proximoPasso({ estado: "resposta_recebida", papel: null }, a);
    expect(p.estado).toBe("qualificacao");
    expect(p.referencia).toBe(REFERENCIAS.ja_tem_site);
    expect(p.referencia).not.toMatch(/ruim|feio|desatualizado|problema/i);
  });
});

describe("quem responde", () => {
  it("recepcionista: pergunta por quem cuida da parte digital, sem apresentação longa", () => {
    const a = analisarResposta({ texto: "Oi! Sou a recepcionista, a doutora está em atendimento. Do que se trata?" });
    expect(a.papel).toBe("recepcionista");
    const p = proximoPasso({ estado: "resposta_recebida", papel: null }, a);
    expect(p.referencia).toMatch(/proprietária|quem cuida/);
    expect((p.referencia ?? "").length).toBeLessThan(260);
    expect(p.passarParaMarcos).toBeNull();
  });

  it("recepcionista que vai encaminhar: oferece material curto, sem pressão", () => {
    const a = analisarResposta({ texto: "Vou passar para a doutora" });
    expect(a.intencao).toBe("encaminhamento");
    const p = proximoPasso({ estado: "resposta_recebida", papel: "recepcionista" }, a);
    expect(p.referencia).toBe(REFERENCIAS.recepcionista_encaminha);
  });

  it("'não sou eu que cuido disso': pede o canal certo, sem contato pessoal", () => {
    const p = proximoPasso({ estado: "resposta_recebida", papel: null }, analisarResposta({ texto: "Não sou eu que cuido disso" }));
    expect(p.referencia).toMatch(/melhor canal ou momento/);
    expect(p.referencia).not.toMatch(/celular|número pessoal|whatsapp dela/i);
  });

  it("proprietária: conversa direta e oferece a demonstração", () => {
    const a = analisarResposta({ texto: "Oi, sou a dona da clínica. Pode falar" });
    expect(a.papel).toBe("proprietaria");
    const p = proximoPasso({ estado: "resposta_recebida", papel: null }, a);
    expect(p.estado).toBe("qualificacao");
    expect(p.referencia).toBe(REFERENCIAS.responsavel);
    expect(p.registrar.videoOferecido).toBe(true);
  });

  it("mensagem automática não é interesse e não avança", () => {
    const a = analisarResposta({
      texto: "Olá! Obrigado por entrar em contato. No momento não estamos disponíveis, retornaremos o mais breve possível.",
    });
    expect(a.intencao).toBe("automatica");
    expect(a.papel).toBe("automatico");
    const p = proximoPasso({ estado: "primeiro_contato", papel: null }, a);
    expect(p.estado).toBe("primeiro_contato");
    expect(p.referencia).toBeNull();
  });
});

describe("objeções e fluxo", () => {
  it("pedido de preço: sem número, passa para o Marcos", () => {
    const a = analisarResposta({ texto: "Quanto custa?" });
    expect(a.objecao).toBe("preco");
    const p = proximoPasso({ estado: "qualificacao", papel: "proprietaria" }, a);
    expect(p.referencia).not.toMatch(/r\$|\d/i);
    expect(p.passarParaMarcos).toBe("perguntou o valor");
  });

  it("aceitou receber o vídeo: autoriza uma vez e o Marcos envia", () => {
    const a = analisarResposta({ texto: "Pode mandar sim", oferecido: true });
    expect(a.aceitou).toBe(true);
    const p = proximoPasso({ estado: "qualificacao", papel: "proprietaria", videoOferecidoEm: "2026-10-13T12:00:00Z" }, a);
    expect(p.estado).toBe("video");
    expect(p.registrar.videoAutorizado).toBe(true);
    expect(p.passarParaMarcos).toBe("autorizou o vídeo");
  });

  it("depois do vídeo não presume que foi assistido e não reenvia", () => {
    const enviado = { estado: "video" as const, papel: "proprietaria" as const, videoOferecidoEm: "x", videoEnviadoEm: "y" };
    const ok = proximoPasso(enviado, analisarResposta({ texto: "Ok" }));
    expect(ok.referencia).toBe(REFERENCIAS.pos_video_sem_sinal);
    const gostou = proximoPasso(enviado, analisarResposta({ texto: "Gostei bastante" }));
    expect(gostou.referencia).toBe(REFERENCIAS.pos_video);
    expect(gostou.registrar.videoOferecido).toBeUndefined();
    const sim = proximoPasso({ ...enviado, estado: "pos_video" }, analisarResposta({ texto: "Sim, faria sentido" }));
    expect(sim.estado).toBe("interesse");
    expect(sim.passarParaMarcos).toBe("gostou da ideia");
  });

  it("cliente recusando: encerra sem insistir", () => {
    const a = analisarResposta({ texto: "Não temos interesse, obrigada" });
    const p = proximoPasso({ estado: "resposta_recebida", papel: null }, a);
    expect(p.estado).toBe("encerrado");
    expect(p.referencia).not.toMatch(/\?/);
  });

  it("pedido para interromper contato: encerra e não oferece nada", () => {
    const a = analisarResposta({ texto: "Por favor, não me mandem mais mensagens" });
    expect(a.pediuParar).toBe(true);
    const p = proximoPasso({ estado: "qualificacao", papel: "proprietaria" }, a);
    expect(p.estado).toBe("encerrado");
    expect(p.referencia).toBe(REFERENCIAS.pediu_para_parar);
  });

  it("'manda por aqui': resumo curto, sem textão", () => {
    const p = proximoPasso({ estado: "resposta_recebida", papel: null }, analisarResposta({ texto: "Manda por aqui mesmo" }));
    expect((p.referencia ?? "").length).toBeLessThan(260);
  });

  it("histórico com mensagens anteriores: estado nunca volta sozinho", () => {
    // Já estava em negociação; um "ok" depois não derruba para resposta recebida.
    const p = proximoPasso({ estado: "negociacao", papel: "proprietaria" }, analisarResposta({ texto: "ok" }));
    expect(p.estado).toBe("negociacao");
  });
});

describe("teste A/B/C", () => {
  it("distribui 10/10/10 equilibrando leads parecidos", () => {
    const contagens: Contagem[] = [];
    const usadas: string[] = [];
    for (let i = 0; i < 30; i += 1) usadas.push(sugerirEstrategia(rico, contagens).estrategia);
    expect(usadas.filter((e) => e === "A")).toHaveLength(10);
    expect(usadas.filter((e) => e === "B")).toHaveLength(10);
    expect(usadas.filter((e) => e === "C")).toHaveLength(10);
    // Leads parecidos se alternam entre os grupos.
    expect(usadas.slice(0, 3).sort()).toEqual(["A", "B", "C"]);
    // Depois dos 30, vale a recomendação pelo perfil.
    expect(sugerirEstrategia(rico, contagens).modo).toBe("recomendada");
  });

  it("estrato separa leads com e sem dados", () => {
    expect(perfilDoLead(rico).estrato).not.toBe(perfilDoLead(pobre).estrato);
    expect(Object.keys(ESTRATEGIAS)).toEqual(["A", "B", "C"]);
  });

  it("nunca declara vencedora com amostra pequena", () => {
    const linha = (estrategia: LinhaMetricas["estrategia"], contatados: number, oportunidades: number): LinhaMetricas => ({
      estrategia, contatados, mensagens_entregues: 0, respostas_humanas: 0, respostas_automaticas: 0, respostas_positivas: 0,
      decisores: 0, videos_autorizados: 0, videos_enviados: 0, interesse: 0, propostas_solicitadas: 0, negociacoes: 0,
      oportunidades, vendas: 0, receita: 0,
    });
    const l = leituraDoTeste([linha("A", 10, 3), linha("B", 10, 0), linha("C", 10, 1)]);
    expect(l.exploratoria).toBe(true);
    expect(l.texto).not.toMatch(/vencedor|melhor estratégia é/i);
    expect(taxa(3, 10)).toBeCloseTo(0.3);
    expect(taxa(1, 0)).toBeNull();
  });
});
