import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/app/(painel)/leads/actions", () => ({ updateCommercial: async () => ({}) }));
import { TesteABC } from "@/components/dashboard/TesteABC";
import { ComercialCard, type ComercialLead } from "@/components/leads/ComercialCard";

describe("painel comercial", () => {
  it("comparativo A/B/C mostra as etapas e avisa que a amostra é exploratória", () => {
    const html = renderToStaticMarkup(
      <TesteABC rows={[{ estrategia: "A", contatados: 4, mensagens_entregues: 2, respostas_humanas: 2, respostas_automaticas: 1, respostas_positivas: 1,
        decisores: 1, videos_autorizados: 1, videos_enviados: 0, interesse: 1, propostas_solicitadas: 0, negociacoes: 0, oportunidades: 1, vendas: 0, receita: 0 }]} />,
    );
    expect(html).toContain("Oportunidade qualificada");
    expect(html).toContain("Teste exploratório");
    expect(html).toContain("1/4 · 25%");
    expect(html).not.toMatch(/vencedor/i);
  });

  it("ficha mostra os campos comerciais e a próxima ação recomendada", () => {
    const l: ComercialLead = {
      id: "11111111-1111-4111-8111-111111111111", stage: "respondeu", do_not_contact: false, prospect_strategy: "C",
      first_contact_at: "2026-10-13T12:00:00Z", contact_role: null, conversation_state: "resposta_recebida", commercial_interest: null,
      video_offered_at: null, video_authorized_at: null, video_sent_at: null, next_follow_up_at: null, loss_reason: null,
    };
    const html = renderToStaticMarkup(<ComercialCard l={l} events={[]} lastReply="Sou a recepcionista, do que se trata?" />);
    expect(html).toContain("C · Curiosidade e vídeo");
    expect(html).toContain("Próxima ação recomendada");
    expect(html).toContain("proprietária");
    expect(html).toContain("Em andamento");
  });
});
