import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ serviceClient: () => ({ rpc }) }));

const { POST: saveReply } = await import("@/app/api/hermes/v1/secretario/[leadId]/route");
const { GET: pending } = await import("@/app/api/hermes/v1/secretario/pendentes/route");
const { POST: postResult } = await import("@/app/api/hermes/v1/envio/[id]/resultado/route");

const TOKEN = "mkt_" + "d".repeat(64);
const LEAD = "11111111-1111-4111-8111-111111111111";
const REF = "2026-10-12T15:00:00.000Z";
const params = <T>(v: T) => ({ params: Promise.resolve(v) });
const req = (path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function db(scopes: string[]) {
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "api_token_check") return { data: scopes.includes(args.p_scope as string) ? "tok" : null, error: null };
    if (fn === "api_secretary_pending") return { data: { status: "ok", conversas: [] }, error: null };
    if (fn === "api_secretary_save") return { data: { status: "criada", id: "s1" }, error: null };
    if (fn === "api_outreach_result") return { data: { status: "registrado" }, error: null };
    return { data: null, error: { message: "inesperado" } };
  });
}

describe("rotas do secretário", () => {
  beforeEach(() => {
    rpc.mockReset();
    db(["mensagens:escrever", "envio:operar"]);
  });

  it("lista conversas pendentes com o token do Hermes", async () => {
    const res = await pending(req("/api/hermes/v1/secretario/pendentes?limit=3"));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("api_secretary_pending", expect.objectContaining({ p_limit: 3 }));
  });

  it("grava resposta válida", async () => {
    const res = await saveReply(req(`/api/hermes/v1/secretario/${LEAD}`, { reply_ref: REF, resposta: "Entendi! Posso te mostrar uma ideia?" }), params({ leadId: LEAD }));
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("api_secretary_save", expect.objectContaining({ p_lead: LEAD }));
  });

  it("recusa resposta com link ou valor e não grava", async () => {
    for (const resposta of ["Veja www.mktech.com.br", "Fica R$ 900."]) {
      const res = await saveReply(req(`/api/hermes/v1/secretario/${LEAD}`, { reply_ref: REF, resposta }), params({ leadId: LEAD }));
      expect(res.status).toBe(422);
    }
    expect(rpc).not.toHaveBeenCalledWith("api_secretary_save", expect.anything());
  });

  it("aceita só passar para o Marcos, sem resposta", async () => {
    const res = await saveReply(req(`/api/hermes/v1/secretario/${LEAD}`, { reply_ref: REF, passar_para_marcos: "quer fechar" }), params({ leadId: LEAD }));
    expect(res.status).toBe(201);
  });

  it("sem resposta nem passar para o Marcos é inválido", async () => {
    const res = await saveReply(req(`/api/hermes/v1/secretario/${LEAD}`, { reply_ref: REF }), params({ leadId: LEAD }));
    expect(res.status).toBe(422);
  });

  it("token do enviador não escreve resposta", async () => {
    db(["envio:operar"]);
    const res = await saveReply(req(`/api/hermes/v1/secretario/${LEAD}`, { reply_ref: REF, resposta: "Oi" }), params({ leadId: LEAD }));
    expect([401, 403]).toContain(res.status);
  });

  it("enviador confirma a etapa resposta", async () => {
    const res = await postResult(req(`/api/hermes/v1/envio/${LEAD}/resultado`, { etapa: "resposta", ok: true }), params({ id: LEAD }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("api_outreach_result", expect.objectContaining({ p_step: "resposta" }));
  });
});
