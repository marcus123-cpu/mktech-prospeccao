import { beforeEach, describe, expect, it, vi } from "vitest";

// Banco simulado: testa autenticação, validação e o que vai para o banco.
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ serviceClient: () => ({ rpc }) }));

const { POST: saveMessage } = await import("@/app/api/hermes/v1/envio/mensagens/[leadId]/route");
const { POST: nextStep } = await import("@/app/api/hermes/v1/envio/proximo/route");
const { POST: postReply } = await import("@/app/api/hermes/v1/envio/respostas/route");
const { POST: postResult } = await import("@/app/api/hermes/v1/envio/[id]/resultado/route");

const TOKEN = "mkt_" + "d".repeat(64);
const LEAD = "11111111-1111-4111-8111-111111111111";
const ctx = {
  business_name: "Clínica Bella Pelle",
  city: "Votuporanga",
  site_status: "site_nao_localizado",
  diagnosis: {
    confidence: "media",
    summary: "Agenda só pelo WhatsApp.",
    digital_presence: "4,9 no Google com 87 avaliações elogiando o atendimento.",
    pains: [{ pain: "Agendamento só pelo direct e WhatsApp", evidence: "Bio" }],
    opportunities: ["Página de harmonização com agendamento online"],
  },
  evidences: [{ kind: "google", summary: "4,9 no Google com 87 avaliações elogiando o atendimento" }],
};
const good = {
  elogio: "4,9 no Google com 87 avaliações elogiando o atendimento",
  dor: "agendamento só pelo direct e WhatsApp",
  melhoria: "página de harmonização com agendamento online",
  mensagem:
    "Vi que a Bella Pelle tem 4,9 no Google com 87 avaliações, e quase todas elogiam o atendimento. Reparei que hoje o agendamento é só pelo direct e pelo WhatsApp. Eu monto páginas com agendamento online para clínicas de estética. Posso te mostrar uma ideia?",
};

function req(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
}

function db(scopes: string[]) {
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "api_token_check") return { data: scopes.includes(args.p_scope as string) ? "tok" : null, error: null };
    if (fn === "api_outreach_context") return { data: ctx, error: null };
    if (fn === "api_outreach_note_failure") return { data: { falhas: 1, fora_da_fila: false }, error: null };
    if (fn === "api_outreach_save") return { data: { status: "criado", message_id: "m1" }, error: null };
    if (fn === "api_outreach_next") return { data: { status: "desligado" }, error: null };
    if (fn === "api_outreach_reply") return { data: { status: "registrada", kind: (args.p as any).kind }, error: null };
    if (fn === "api_outreach_result") return { data: { status: "registrado" }, error: null };
    return { data: null, error: { message: "inesperado" } };
  });
}

const params = <T>(v: T) => ({ params: Promise.resolve(v) });

describe("rotas do envio automático", () => {
  beforeEach(() => {
    rpc.mockReset();
    db(["mensagens:escrever", "envio:operar"]);
  });

  it("grava mensagem válida", async () => {
    const res = await saveMessage(req(`/api/hermes/v1/envio/mensagens/${LEAD}`, good), params({ leadId: LEAD }));
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("api_outreach_save", expect.objectContaining({ p_lead: LEAD }));
  });

  it("erro do agente nunca entra na fila: recusa, conta a falha e não salva", async () => {
    const res = await saveMessage(
      req(`/api/hermes/v1/envio/mensagens/${LEAD}`, {
        ...good,
        mensagem: "Ocorreu um erro ao gerar a mensagem para este lead. Tente novamente mais tarde, estamos verificando o problema.",
      }),
      params({ leadId: LEAD }),
    );
    expect(res.status).toBe(422);
    expect(rpc).toHaveBeenCalledWith("api_outreach_note_failure", expect.objectContaining({ p_lead: LEAD }));
    expect(rpc).not.toHaveBeenCalledWith("api_outreach_save", expect.anything());
  });

  it("JSON fora do formato também conta como falha e não salva", async () => {
    const res = await saveMessage(req(`/api/hermes/v1/envio/mensagens/${LEAD}`, { texto: "oi" }), params({ leadId: LEAD }));
    expect(res.status).toBe(422);
    expect(rpc).toHaveBeenCalledWith("api_outreach_note_failure", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("api_outreach_save", expect.anything());
  });

  it("token do Hermes não opera o envio", async () => {
    db(["mensagens:escrever"]);
    expect((await nextStep(req("/api/hermes/v1/envio/proximo", {}))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalledWith("api_outreach_next", expect.anything());
  });

  it("token do enviador não escreve mensagem", async () => {
    db(["envio:operar"]);
    expect((await saveMessage(req(`/api/hermes/v1/envio/mensagens/${LEAD}`, good), params({ leadId: LEAD }))).status).toBe(403);
  });

  it("classifica a resposta antes de gravar", async () => {
    await postReply(req("/api/hermes/v1/envio/respostas", { telefone: "+5517991234567", texto: "Esta é uma mensagem automática." }));
    expect(rpc).toHaveBeenCalledWith("api_outreach_reply", expect.objectContaining({ p: expect.objectContaining({ kind: "automatica" }) }));
    await postReply(req("/api/hermes/v1/envio/respostas", { telefone: "+5517991234567", texto: "Oi, quem é?" }));
    expect(rpc).toHaveBeenLastCalledWith("api_outreach_reply", expect.objectContaining({ p: expect.objectContaining({ kind: "humana" }) }));
  });

  it("áudio vai como pessoa, sem precisar de texto", async () => {
    const res = await postReply(req("/api/hermes/v1/envio/respostas", { telefone: "+5517991234567", tipo: "audio" }));
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenLastCalledWith(
      "api_outreach_reply",
      expect.objectContaining({ p: expect.objectContaining({ kind: "humana", media: "audio", body: "[áudio]" }) }),
    );
    expect((await postReply(req("/api/hermes/v1/envio/respostas", { telefone: "+5517991234567" }))).status).toBe(422);
  });

  it("resultado exige etapa válida", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect((await postResult(req(`/api/hermes/v1/envio/${id}/resultado`, { etapa: "outra", ok: true }), params({ id }))).status).toBe(422);
    expect((await postResult(req(`/api/hermes/v1/envio/${id}/resultado`, { etapa: "saudacao", ok: true }), params({ id }))).status).toBe(200);
  });
});
