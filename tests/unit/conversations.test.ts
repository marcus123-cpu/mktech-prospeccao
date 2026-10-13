import { describe, expect, it } from "vitest";
import { conversationState, type Conversation } from "@/lib/conversations";

const base: Conversation = {
  id: "a", business_name: "Clínica", city: "Bauru", stage: "respondeu", phone_e164: null, fit_score: 70,
  secretary_handoff_at: null, secretary_handoff_reason: null, do_not_contact: false,
  last_in_at: "2026-10-12T15:01:00Z", last_in_body: "Oi", last_in_media: "texto",
  last_out_at: "2026-10-12T15:00:00Z", pending_status: null, pending_body: null, activity_at: "2026-10-12T15:01:00Z",
};
describe("estado do atendimento", () => {
  it("distingue resposta pendente de cliente aguardando após nossa resposta", () => {
    expect(conversationState(base)).toBe("aguardando");
    expect(conversationState({ ...base, last_out_at: "2026-10-12T15:02:00Z" })).toBe("respondida");
    expect(conversationState({ ...base, last_out_at: null })).toBe("aguardando");
  });
  it("prioriza bloqueio e controle humano sobre filas do bot", () => {
    expect(conversationState({ ...base, do_not_contact: true, pending_status: "pronta" })).toBe("encerrada");
    expect(conversationState({ ...base, secretary_handoff_at: base.last_in_at, pending_status: "pronta" })).toBe("minhas");
    expect(conversationState({ ...base, pending_status: "pronta" })).toBe("bot");
    expect(conversationState({ ...base, pending_status: "falhou" })).toBe("falhou");
  });
});
