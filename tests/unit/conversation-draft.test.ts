import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { modelDraft, generateReplyDraft, type DraftContext } from "@/lib/conversation-draft";

const context = (body: string): DraftContext => ({
  business_name: "Clínica", city: "Bauru", memory: null, diagnosis: null,
  messages: [
    { direction: "saida", source: "abordagem", body: "Posso mostrar uma ideia?", media: "texto" },
    { direction: "entrada", source: "humana", body, media: "texto" },
  ],
});
describe("rascunho contextual", () => {
  it.each([
    "Nao estamos interessadas, obrigada!!", "Não estou interessado", "Não temos interesse",
    "Não quero saber o preço", "Sem interesse", "Não, obrigada", "Não nos envie mais mensagens",
  ])("respeita a recusa: %s", (body) => {
    const draft = modelDraft(context(body));
    expect(draft.intent).toBe("Cliente recusou a proposta");
    expect(draft.reply).not.toMatch(/mostrar|ligação|prefere|\?/i);
    expect(draft.next_action).toContain("Não insistir");
  });
  it.each(["Oi tudo bem?", "Obrigada", "Não entendi", "Talvez depois"])("não inventa aceite: %s", (body) => {
    expect(modelDraft(context(body)).intent).not.toBe("Cliente topou ver a ideia");
  });
  it("distingue aceite e pedido de preço", () => {
    expect(modelDraft(context("Sim, pode mostrar")).intent).toBe("Cliente topou ver a ideia");
    expect(modelDraft(context("Qual o preço?")).intent).toBe("Cliente perguntou o valor");
  });
  it("usa a última entrada, sem tomar o aceite anterior como atual", () => {
    const c = context("Sim, pode mostrar");
    c.messages.push({ direction: "entrada", source: "humana", body: "Não estamos interessadas, obrigada", media: "texto" });
    expect(modelDraft(c).intent).toBe("Cliente recusou a proposta");
  });
  it("não chama a IA para converter uma recusa em venda", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    try {
      expect((await generateReplyDraft(context("Não estamos interessadas, obrigada!!"))).intent).toBe("Cliente recusou a proposta");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
