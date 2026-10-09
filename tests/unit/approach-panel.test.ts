import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { adriele } from "./fixtures/approach";

vi.mock("@/app/(painel)/leads/actions", () => ({
  saveMessageVersion: vi.fn(),
  markMessageUsed: vi.fn(),
  requestApproach: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const { ApproachPanel } = await import("@/components/leads/ApproachPanel");

const base = { lead_id: "l", batch_id: "b1", parent_id: null, pain_used: "Agendamento por telefone", evidence_used: "Post de 03/10/2026", risk: "baixo", alert: null };
const messages = [
  { ...base, id: "m1", style: "direta", body: "Oi, Adriele!\nVi seu post de 03/10. Posso te mostrar?", source: "hermes", created_at: "2026-10-09T10:00:00Z" },
  { ...base, id: "m2", style: "pulga", body: "Adriele, quem vê o post de 03/10 consegue marcar fora do horário?", source: "hermes", created_at: "2026-10-09T10:00:00Z" },
  { ...base, id: "m3", style: "consultiva", body: "Oi, Adriele! Como as clientes te encontram hoje?", source: "hermes", created_at: "2026-10-09T10:00:00Z" },
  { ...base, id: "m4", parent_id: "m1", style: "direta", body: "Oi, Adriele! Texto editado por mim. Posso te mostrar?", source: "edicao", created_at: "2026-10-09T11:00:00Z" },
] as const;

describe("aba Abordagem", () => {
  it("mostra aviso de verificação pendente, a versão editada mais nova e o link do WhatsApp", () => {
    const html = renderToStaticMarkup(
      createElement(ApproachPanel, { leadId: "l", ctx: adriele, messages: messages as any, uses: [], requestedAt: null }),
    );
    expect(html).toContain("Verificação pendente.");
    expect(html).toContain("Texto editado por mim");
    expect(html).toContain("Pulga atrás da orelha");
    expect(html).toContain("https://wa.me/5517997562775?text=Oi%2C%20Adriele!%20Texto");
    expect(html).toContain("Histórico de versões (4)");
    expect(html).not.toContain("Poucas evidências");
  });

  it("sem mensagens, oferece pedir ao Hermes", () => {
    const html = renderToStaticMarkup(createElement(ApproachPanel, { leadId: "l", ctx: adriele, messages: [], uses: [], requestedAt: null }));
    expect(html).toContain("Pedir mensagens ao Hermes");
  });
});
