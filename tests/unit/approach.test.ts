import { describe, expect, it } from "vitest";
import { messageIssues, needsCaution, validateApproach, weakEvidence, WEAK_ALERT, whatsappWithText, type ApproachPayload } from "@/lib/approach";
import { adriele, dheinyfer } from "./fixtures/approach";

const adrieleOk: ApproachPayload = {
  alerta: null,
  variantes: [
    {
      estilo: "direta",
      mensagem:
        "Oi, Adriele! Vi seu post de 03/10 pedindo para agendar a avaliação facial pelo telefone. Sou o Marcos, da MKTech, e monto páginas simples onde a cliente vê os serviços e já chama você. Se ainda não tiver uma página assim, posso te mandar um exemplo?",
      dor_usada: "Agendamento depende do telefone",
      evidencia_usada: "Post de 03/10/2026 fornece telefone como chamada à ação para agendamento",
      risco: "baixo",
    },
    {
      estilo: "pulga",
      mensagem:
        "Adriele, uma curiosidade: quem chega pelo post de 03/10 da avaliação facial e quer saber mais sobre limpeza de pele ou peelings encontra essas informações reunidas em algum lugar fora das redes?",
      dor_usada: "Informações dispersas",
      evidencia_usada: "Threads com posts de 28/09, 02/10 e 03/10/2026 sobre avaliação facial e agendamento por telefone",
      risco: "baixo",
    },
    {
      estilo: "consultiva",
      mensagem:
        "Oi, Adriele! Sou o Marcos, trabalho com páginas para profissionais de estética facial. Vi uma matéria de 2025 sobre a inauguração do seu espaço, mas não sei se ainda está tudo igual por aí. Como as clientes costumam te encontrar hoje?",
      dor_usada: "Descoberta depende de redes e telefone",
      evidencia_usada: "Notícia de 20/05/2025",
      risco: "baixo",
    },
  ],
};

const dheinyferOk: ApproachPayload = {
  alerta: null,
  variantes: [
    {
      estilo: "direta",
      mensagem:
        "Olá, Dheinyfer! Vi o site dradheinyfervaleretto.com.br e que o link antigo da bio levava para o Canva. Sou o Marcos, da MKTech, e ajudo a deixar o agendamento da harmonização facial direto no site. Faz sentido eu te mostrar como ficaria?",
      dor_usada: "Agendamento passando por link de terceiros",
      evidencia_usada: "Bio usava bit.ly/DraDheinyfer, que redirecionou para o Canva; site dradheinyfervaleretto.com.br",
      risco: "baixo",
    },
    {
      estilo: "pulga",
      mensagem:
        "Dheinyfer, vi que o site dradheinyfervaleretto.com.br já existe e que a bio chegou a mandar para uma página no Canva. Quem clica na bio hoje cai direto no site ou ainda passa por outro link?",
      dor_usada: "Link da bio fora do site",
      evidencia_usada: "bit.ly/DraDheinyfer redirecionou para visualização Canva",
      risco: "baixo",
    },
    {
      estilo: "consultiva",
      mensagem:
        "Oi, Dheinyfer! Sou o Marcos, trabalho com sites para clínicas de harmonização facial. Vi seu site e fiquei pensando em como as pacientes chegam até o agendamento. Hoje o que mais te ajudaria nessa parte?",
      dor_usada: "Caminho até o agendamento",
      evidencia_usada: null,
      risco: "baixo",
    },
  ],
};

describe("regras da abordagem", () => {
  it("Adriele: lote com verificação pendente e frases condicionais passa", () => {
    expect(needsCaution(adriele)).toBe(true);
    expect(validateApproach(adriele, adrieleOk)).toEqual([]);
  });

  it("Adriele: afirmar que não tem site ou que perde clientes é recusado", () => {
    expect(messageIssues(adriele, "Adriele, vi que você não tem site. Posso ajudar?").join()).toMatch(/não afirme/);
    expect(messageIssues(adriele, "Adriele, você está perdendo clientes sem página. Posso ajudar?").join()).toMatch(/perde clientes/);
    expect(messageIssues(adriele, "Adriele, caso não tenha site ainda, posso te mostrar um exemplo?")).toEqual([]);
  });

  it("Adriele: não inventa procedimento, preço, número, cidade nem nota", () => {
    const issues = messageIssues(
      adriele,
      "Adriele, vi que você faz botox por R$ 300 em Bauru e tem 4,9 estrelas. Posso ajudar?",
    ).join("\n");
    expect(issues).toMatch(/botox/);
    expect(issues).toMatch(/preço/);
    expect(issues).toMatch(/300/);
    expect(issues).toMatch(/bauru/);
    expect(issues).toMatch(/nota/);
  });

  it("Dheinyfer: parte do site existente e não afirma a cidade pendente", () => {
    expect(validateApproach(dheinyfer, dheinyferOk)).toEqual([]);
    expect(messageIssues(dheinyfer, "Dheinyfer, vi seu instituto em Fernandópolis. Posso ajudar?").join()).toMatch(
      /fernandopolis.*confirmar/,
    );
    expect(messageIssues(dheinyfer, "Dheinyfer, vi o site outrosite.com.br. Posso ajudar?").join()).toMatch(/outrosite/);
  });

  it("recusa pressão, elogio genérico, IA, mais de uma pergunta e falta do nome", () => {
    const issues = messageIssues(
      adriele,
      "Oi! Seu trabalho é incrível. Uso inteligência artificial para achar clientes, não perca essa chance! Quer? Topa?",
    ).join("\n");
    expect(issues).toMatch(/pressão/);
    expect(issues).toMatch(/elogio/);
    expect(issues).toMatch(/IA/);
    expect(issues).toMatch(/uma pergunta/);
    expect(issues).toMatch(/primeiro nome/);
  });

  it("direta e pulga precisam de evidência real; risco alto é recusado; frase repetida também", () => {
    const bad: ApproachPayload = {
      alerta: null,
      variantes: [
        { ...adrieleOk.variantes[0], evidencia_usada: "achei interessante", risco: "alto" },
        { ...adrieleOk.variantes[1] },
        { ...adrieleOk.variantes[2], mensagem: adrieleOk.variantes[0].mensagem },
      ],
    };
    const errors = validateApproach(adriele, bad).join("\n");
    expect(errors).toMatch(/evidencia_usada/);
    expect(errors).toMatch(/risco alto/);
    expect(errors).toMatch(/Frase repetida/);
  });

  it("evidência fraca: só uma consultiva com o alerta", () => {
    const weak = { ...adriele, diagnosis: { ...adriele.diagnosis, pains: [] } };
    expect(weakEvidence(weak)).toBe(true);
    expect(validateApproach(weak, adrieleOk).join()).toMatch(/só UMA variante/);
    expect(validateApproach(weak, { alerta: WEAK_ALERT, variantes: [adrieleOk.variantes[2]] })).toEqual([]);
  });

  it("exige as 3 variantes, uma de cada estilo", () => {
    expect(validateApproach(adriele, { variantes: adrieleOk.variantes.slice(0, 2) }).join()).toMatch(/exatamente 3/);
  });

  it("WhatsApp preserva acentos e quebras de linha", () => {
    const url = whatsappWithText("+5517997562775", "Olá, Adriele!\nTudo bem? Ação")!;
    expect(url.startsWith("https://wa.me/5517997562775?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("Olá, Adriele!\nTudo bem? Ação");
    expect(url).toContain("%0A");
    expect(whatsappWithText(null, "x")).toBeNull();
  });
});
