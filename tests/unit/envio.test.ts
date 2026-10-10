import { describe, expect, it } from "vitest";
import { validateOutreach, type LeadContext, type OutreachPayload } from "@/lib/envio/mensagem";
import { classifyReply } from "@/lib/envio/respostas";

const ctx: LeadContext = {
  business_name: "Clínica Bella Pelle",
  responsible_name: "Ana Souza",
  city: "Votuporanga",
  site_status: "site_nao_localizado",
  services: ["harmonização facial", "limpeza de pele"],
  diagnosis: {
    confidence: "media",
    summary: "Clínica de estética facial ativa, agenda só pelo WhatsApp.",
    digital_presence: "Instagram ativo, 4,9 no Google com 87 avaliações elogiando o atendimento.",
    pains: [{ pain: "Agendamento só pelo direct e WhatsApp", evidence: "Bio: agende pelo direct ou WhatsApp" }],
    opportunities: ["Página de harmonização com agendamento online"],
    offer: "landing_por_procedimento",
  },
  evidences: [{ kind: "google", summary: "4,9 no Google com 87 avaliações elogiando o atendimento" }],
};

const good: OutreachPayload = {
  elogio: "4,9 no Google com 87 avaliações elogiando o atendimento",
  dor: "agendamento só pelo direct e WhatsApp",
  melhoria: "página de harmonização com agendamento online",
  mensagem:
    "Vi que a Bella Pelle tem 4,9 no Google com 87 avaliações, e quase todas elogiam o atendimento. Reparei que hoje o agendamento é só pelo direct e pelo WhatsApp, então quem pesquisa harmonização em Votuporanga não encontra uma página de vocês. Eu monto páginas com agendamento online para clínicas de estética. Posso te mostrar uma ideia de como ficaria a de vocês?",
};

describe("mensagem do envio automático", () => {
  it("aceita a mensagem do exemplo da skill", () => {
    expect(validateOutreach(ctx, good)).toEqual([]);
  });

  it.each([
    ["Ocorreu um erro ao gerar a mensagem. Tente novamente mais tarde, por favor, estamos verificando o problema agora mesmo."],
    ['{"mensagem": "Vi que a Bella Pelle tem 4,9 no Google com 87 avaliações e o agendamento é só pelo WhatsApp hoje."}'],
    ["Desculpe, como modelo de linguagem não posso escrever mensagens de prospecção para este lead da clínica de estética."],
    ["Error: request failed with status 500 while generating the outreach message for Bella Pelle in Votuporanga today."],
    ["**Mensagem:** Vi que a Bella Pelle tem 4,9 no Google com 87 avaliações e o agendamento é só pelo direct e WhatsApp."],
  ])("recusa saída técnica do agente: %s", (mensagem) => {
    const errors = validateOutreach(ctx, { ...good, mensagem });
    expect(errors.join(" ")).toMatch(/técnico|erro/);
  });

  it("recusa saudação junto (ela vai antes, separada)", () => {
    const errors = validateOutreach(ctx, { ...good, mensagem: `Bom dia, Ana! ${good.mensagem}` });
    expect(errors.join(" ")).toMatch(/saudação/);
  });

  it("recusa fatos inventados", () => {
    const m = good.mensagem.replace("87 avaliações", "300 avaliações").replace("harmonização", "botox");
    const errors = validateOutreach(ctx, { ...good, mensagem: m });
    expect(errors.join(" ")).toMatch(/"300"/);
    expect(errors.join(" ")).toMatch(/botox/);
  });

  it("recusa elogio genérico, pressão, link e preço", () => {
    const m = `Amei o seu perfil, de verdade. ${good.mensagem.replace("Posso", "Aproveite: só hoje R$ 300 em www.mktech.com.br. Posso")}`;
    const errors = validateOutreach(ctx, { ...good, mensagem: m }).join(" ");
    expect(errors).toMatch(/genérico/);
    expect(errors).toMatch(/pressão/);
    expect(errors).toMatch(/links/);
    expect(errors).toMatch(/preço/);
  });

  it("exige elogio, dor e melhoria vindos dos dados e usados na mensagem", () => {
    const errors = validateOutreach(ctx, { ...good, elogio: "fotos lindas de viagens pela europa" }).join(" ");
    expect(errors).toMatch(/elogio precisa vir/);
  });

  it("com o site não verificado, só forma condicional", () => {
    const c = { ...ctx, site_status: "verificacao_pendente" };
    const m = good.mensagem.replace("Eu monto", "Vocês estão sem site. Eu monto");
    expect(validateOutreach(c, { ...good, mensagem: m }).join(" ")).toMatch(/condicional/);
  });

  it("lead sem diagnóstico não recebe mensagem", () => {
    expect(validateOutreach({ ...ctx, diagnosis: null }, good).join(" ")).toMatch(/sem diagnóstico/);
  });
});

describe("classificação de respostas", () => {
  it.each([
    "Olá! Obrigado por entrar em contato com a Clínica Bella Pelle. No momento não estamos disponíveis, retornaremos assim que possível.",
    "Seja bem-vinda à Bella Pelle! Digite 1 para agendar, 2 para valores, 3 para falar com a recepção.",
    "Nosso horário de atendimento é de segunda a sexta, das 9h às 18h. Deixe sua mensagem.",
    "Esta é uma mensagem automática.",
  ])("automática: %s", (texto) => {
    expect(classifyReply({ texto }).kind).toBe("automatica");
  });

  it.each(["Oi, quem é?", "Bom dia! Pode falar", "Tenho interesse sim, quanto fica?", "Oi! Obrigada pelo contato, quem fala?", "sim"])(
    "pessoa: %s",
    (texto) => {
      expect(classifyReply({ texto })).toMatchObject({ kind: "humana", optOut: false });
    },
  );

  it("resposta longa em segundos é automática", () => {
    const texto = "Oi, tudo bem? Já já te respondo, estou atendendo uma cliente agora mesmo.";
    expect(classifyReply({ texto, segundos_desde_envio: 2 }).kind).toBe("automatica");
    expect(classifyReply({ texto, segundos_desde_envio: 120 }).kind).toBe("humana");
  });

  it("texto idêntico a uma resposta anterior é automático", () => {
    const texto = "Oi, tudo bem? Já já te respondo!";
    expect(classifyReply({ texto, anteriores: [texto] }).kind).toBe("automatica");
  });

  it.each(["Quanto custa?", "Qual o valor de uma página dessas?", "me passa o orçamento", "Quanto fica pra fazer?"])(
    "pergunta de valor: %s",
    (texto) => {
      expect(classifyReply({ texto })).toMatchObject({ kind: "humana", asksPrice: true });
    },
  );

  it("conversa sem preço não é pergunta de valor", () => {
    expect(classifyReply({ texto: "Oi, quem é?" }).asksPrice).toBe(false);
  });

  it.each(["Não tenho interesse", "pare", "Não me mande mais mensagens", "remova meu número"])("pedido para parar: %s", (texto) => {
    expect(classifyReply({ texto })).toMatchObject({ kind: "humana", optOut: true });
  });
});
