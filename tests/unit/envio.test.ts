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
    "Vi que a Bella Pelle tem 4,9 no Google com 87 avaliações elogiando o atendimento. Hoje o agendamento é só pelo direct e WhatsApp, e quem pesquisa harmonização em Votuporanga não encontra uma página de vocês. Eu crio páginas com agendamento online. Posso te mostrar uma ideia?",
};

describe("mensagem do envio automático", () => {
  it("aceita a mensagem do exemplo da skill", () => {
    expect(validateOutreach(ctx, good)).toEqual([]);
  });

  it.each([
    ["Ocorreu um erro ao gerar a mensagem. Tente novamente mais tarde, por favor, estamos verificando o problema agora mesmo."],
    ['{"mensagem": "Vi que a Bella Pelle tem 4,9 no Google com 87 avaliações e o agendamento é só pelo WhatsApp hoje."}'],
    ["Desculpe, como modelo de linguagem não posso escrever mensagens de prospecção para este lead da clínica de estética."],
    ["Error: request failed with status 500 while generating the outreach message for Bella Pelle in Votuporanga."],
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
    const m = good.mensagem.replace("Eu crio", "Vocês estão sem site. Eu crio");
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

  it("evento sem texto não é pessoa", () => {
    expect(classifyReply({ texto: "[mensagem sem texto]", tipo: "outro" }).kind).toBe("automatica");
    expect(classifyReply({ texto: "", tipo: "outro" }).kind).toBe("automatica");
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

describe("serviços da MKTech na mensagem", () => {
  it("pode citar sistema, automação e o caso Polpuja", () => {
    const mensagem =
      "Vi que a Bella Pelle tem 4,9 no Google com 87 avaliações elogiando o atendimento. Hoje o agendamento é só pelo direct e WhatsApp. Fiz o sistema da Polpuja e crio páginas de harmonização com agendamento online e automações. Posso te mostrar uma ideia?";
    expect(validateOutreach(ctx, { ...good, mensagem })).toEqual([]);
  });

  it("mensagem longa demais é recusada (curta e clara)", () => {
    expect(validateOutreach(ctx, { ...good, mensagem: good.mensagem + " " + good.mensagem }).join(" ")).toMatch(/Passou de 400/);
  });

  it("não pode dizer que a mensagem é automática", () => {
    const mensagem = good.mensagem.replace("Posso", "Esta é uma mensagem automática. Posso");
    expect(validateOutreach(ctx, { ...good, mensagem }).join(" ")).toMatch(/IA, sistema ou automação/);
  });
});

describe("áudio", () => {
  it("áudio é sempre de pessoa", () => {
    expect(classifyReply({ texto: "[áudio]", tipo: "audio" })).toMatchObject({ kind: "humana", reason: expect.stringMatching(/áudio/) });
  });
});

import { leadResumo } from "@/lib/leads/resumo";

describe("copiar diagnóstico", () => {
  it("junta dados, diagnóstico, evidências, envio e respostas em texto", () => {
    const t = leadResumo({
      lead: { business_name: "Clínica Bella Pelle", city: "Votuporanga", state: "SP", site_status: "site_nao_localizado", priority: "alta", stage: "contatado", phone_e164: "+5517991234567", instagram_handle: "bellapelle", services: ["botox"] },
      diagnosis: { fit_score: 82, confidence: "media", summary: "Agenda só pelo WhatsApp.", pains: [{ pain: "Agenda manual", evidence: "Bio" }], opportunities: ["Página com agenda"], offer: "landing_page", offer_reason: "Simples", created_at: "2026-10-10T12:00:00Z" },
      evidences: [{ kind: "google", summary: "4,9 no Google", observed_at: "2026-10-10T12:00:00Z" }],
      outreach: { status: "enviada", body: "Olá!", sent_at: "2026-10-10T12:05:00Z" },
      replies: [{ body: "Quanto custa?", kind: "humana", received_at: "2026-10-10T12:10:00Z" }],
    });
    for (const s of ["LEAD: Clínica Bella Pelle", "+5517991234567", "@bellapelle", "Nota: 82/100", "- Agenda manual (evidência: Bio)", "[google] 4,9 no Google", "ENVIO AUTOMÁTICO", "(pessoa): Quanto custa?"]) {
      expect(t).toContain(s);
    }
  });

  it("omite o que não existe", () => {
    const t = leadResumo({ lead: { business_name: "X", city: "Bauru", state: "SP", site_status: "site_nao_localizado", priority: "media", stage: "novo" } });
    expect(t).not.toContain("DIAGNÓSTICO");
    expect(t).not.toContain("null");
  });
});
