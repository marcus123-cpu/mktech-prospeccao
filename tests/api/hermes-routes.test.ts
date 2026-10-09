import { beforeEach, describe, expect, it, vi } from "vitest";

// O banco é simulado: aqui só testamos autenticação, validação e códigos HTTP das rotas.
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ serviceClient: () => ({ rpc }) }));

const { POST: registerCandidate } = await import("@/app/api/hermes/v1/candidates/route");
const { GET: getSettings } = await import("@/app/api/hermes/v1/settings/route");

const TOKEN = "mkt_" + "c".repeat(64);
const candidate = {
  business_name: "Clínica Teste",
  city: "Bauru",
  selection_reason: "Sem site próprio",
  evidences: [{ kind: "busca", summary: "Nenhum domínio encontrado" }],
};

function req(path: string, init: { body?: unknown; token?: string | null; key?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token !== null) headers.authorization = `Bearer ${init.token ?? TOKEN}`;
  if (init.key) headers["idempotency-key"] = init.key;
  return new Request(`http://localhost${path}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Simula api_token_check aceitando só os escopos informados. */
function tokenWithScopes(...scopes: string[]) {
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "api_token_check") return { data: scopes.includes(args.p_scope as string) ? "token-1" : null, error: null };
    if (fn === "api_register_candidate") return { data: { status: "criado", lead_id: "l1" }, error: null };
    if (fn === "api_get_settings") return { data: { status: "ok", settings: { routine_enabled: false } }, error: null };
    return { data: null, error: { message: "inesperado" } };
  });
}

describe("rotas da API do Hermes", () => {
  beforeEach(() => {
    rpc.mockReset();
    tokenWithScopes("candidatos:criar", "config:ler");
  });

  it("recusa requisição sem token ou com token malformado", async () => {
    expect((await getSettings(req("/api/hermes/v1/settings", { token: null }))).status).toBe(401);
    expect((await getSettings(req("/api/hermes/v1/settings", { token: "abc" }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recusa token sem o escopo da rota", async () => {
    tokenWithScopes("config:ler");
    const res = await registerCandidate(req("/api/hermes/v1/candidates", { body: { candidate }, key: "chave-123456" }));
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalledWith("api_register_candidate", expect.anything());
  });

  it("só guarda o hash do token, nunca o token", async () => {
    await getSettings(req("/api/hermes/v1/settings"));
    const args = rpc.mock.calls[0][1];
    expect(JSON.stringify(args)).not.toContain(TOKEN);
    expect(args.p_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("exige Idempotency-Key", async () => {
    const res = await registerCandidate(req("/api/hermes/v1/candidates", { body: { candidate } }));
    expect(res.status).toBe(422);
  });

  it("recusa etapa e dados comerciais no candidato", async () => {
    const res = await registerCandidate(
      req("/api/hermes/v1/candidates", { body: { candidate: { ...candidate, stage: "fechado" } }, key: "chave-123456" }),
    );
    expect(res.status).toBe(422);
    expect(rpc).not.toHaveBeenCalledWith("api_register_candidate", expect.anything());
  });

  it("cadastra candidato válido e devolve 201", async () => {
    const res = await registerCandidate(req("/api/hermes/v1/candidates", { body: { candidate }, key: "chave-123456" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "criado" });
    const call = rpc.mock.calls.find((c) => c[0] === "api_register_candidate")!;
    expect(call[1]).toMatchObject({ p_token: "token-1", p_key: "chave-123456" });
  });

  it("limite atingido vira 409 e falha do banco vira 503", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "api_token_check" ? { data: "token-1", error: null } : { data: { status: "limite_atingido" }, error: null },
    );
    let res = await registerCandidate(req("/api/hermes/v1/candidates", { body: { candidate }, key: "chave-123456" }));
    expect(res.status).toBe(409);
    rpc.mockImplementation(async (fn: string) =>
      fn === "api_token_check" ? { data: "token-1", error: null } : { data: null, error: { message: "x" } },
    );
    res = await registerCandidate(req("/api/hermes/v1/candidates", { body: { candidate }, key: "chave-123456" }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("5");
  });

  it("recusa JSON inválido e corpo grande", async () => {
    const bad = new Request("http://localhost/api/hermes/v1/candidates", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "idempotency-key": "chave-123456" },
      body: "{nao é json",
    });
    expect((await registerCandidate(bad)).status).toBe(400);
    const big = { candidate: { ...candidate, selection_reason: "x".repeat(300 * 1024) } };
    expect((await registerCandidate(req("/api/hermes/v1/candidates", { body: big, key: "chave-123456" }))).status).toBe(413);
  });
});
