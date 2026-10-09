import { beforeEach, describe, expect, it, vi } from "vitest";
import { adriele } from "../unit/fixtures/approach";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ serviceClient: () => ({ rpc }) }));

const { POST: saveApproach } = await import("@/app/api/hermes/v1/approach/[leadId]/route");
const { GET: pendingApproach } = await import("@/app/api/hermes/v1/approach/pending/route");

const TOKEN = "mkt_" + "c".repeat(64);
const LEAD = "11111111-2222-4333-8444-555555555555";

function req(path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (leadId = LEAD) => ({ params: Promise.resolve({ leadId }) });

const consultiva = {
  estilo: "consultiva",
  mensagem: "Oi, Adriele! Sou o Marcos e trabalho com páginas para estética facial. Como as clientes costumam te encontrar hoje?",
  risco: "baixo",
};
const good = {
  alerta: null,
  variantes: [
    {
      estilo: "direta",
      mensagem: "Oi, Adriele! Vi seu post de 03/10 pedindo para agendar a avaliação facial pelo telefone. Se ainda não tiver uma página com seus serviços, posso te mandar um exemplo?",
      evidencia_usada: "Post de 03/10/2026 fornece telefone como chamada à ação para agendamento",
      risco: "Médio",
    },
    {
      estilo: "pulga",
      mensagem: "Adriele, quem vê o post de 03/10 da avaliação facial e quer saber sobre peelings encontra isso reunido em algum lugar fora das redes?",
      evidencia_usada: "Threads com posts de 28/09, 02/10 e 03/10/2026 sobre avaliação facial",
      risco: "baixo",
    },
    consultiva,
  ],
};

describe("API de abordagem", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "api_token_check") return { data: "token-1", error: null };
      if (fn === "api_approach_context") return { data: adriele, error: null };
      if (fn === "api_save_approach") return { data: { status: "criado", batch_id: "b1", count: 3 }, error: null };
      if (fn === "api_note_approach_failure") return { data: null, error: null };
      if (fn === "api_pending_approach") return { data: { status: "ok", leads: [adriele] }, error: null };
      return { data: null, error: { message: "inesperado" } };
    });
  });

  it("lista pendentes com limite entre 1 e 20", async () => {
    const res = await pendingApproach(req("/api/hermes/v1/approach/pending?limit=99"));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("api_pending_approach", { p_token: "token-1", p_limit: 20 });
  });

  it("grava lote dentro das regras e normaliza 'Médio'", async () => {
    const res = await saveApproach(req(`/api/hermes/v1/approach/${LEAD}`, good), params());
    expect(res.status).toBe(201);
    const saved = rpc.mock.calls.find((c) => c[0] === "api_save_approach")![1];
    expect(saved.p.variantes[0].risco).toBe("medio");
  });

  it("recusa com 422 e lista de erros quando afirma algo sem verificação", async () => {
    const bad = { ...good, variantes: [{ ...good.variantes[0], mensagem: "Adriele, você não tem site e está perdendo clientes. Posso ajudar?" }, good.variantes[1], consultiva] };
    const res = await saveApproach(req(`/api/hermes/v1/approach/${LEAD}`, bad), params());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors.join()).toMatch(/não afirme/);
    expect(rpc).not.toHaveBeenCalledWith("api_save_approach", expect.anything());
    expect(rpc).toHaveBeenCalledWith("api_note_approach_failure", { p_token: "token-1", p_lead: LEAD });
  });

  it("recusa mensagem acima de 500 caracteres e lead_id inválido", async () => {
    const long = { ...good, variantes: [{ ...consultiva, mensagem: "a".repeat(501) }] };
    expect((await saveApproach(req(`/api/hermes/v1/approach/${LEAD}`, long), params())).status).toBe(422);
    expect((await saveApproach(req(`/api/hermes/v1/approach/x`, good), params("x"))).status).toBe(422);
  });

  it("lead inexistente vira 422", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "api_token_check" ? { data: "token-1", error: null } : { data: null, error: null },
    );
    expect((await saveApproach(req(`/api/hermes/v1/approach/${LEAD}`, good), params())).status).toBe(422);
  });
});
