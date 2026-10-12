import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ serviceClient: () => ({ rpc }) }));

const { GET } = await import("@/app/api/hermes/v1/pedidos/route");
const TOKEN = "mkt_" + "e".repeat(64);
const req = () => new Request("http://localhost/api/hermes/v1/pedidos", { headers: { authorization: `Bearer ${TOKEN}` } });

describe("GET /pedidos", () => {
  beforeEach(() => rpc.mockReset());

  it("devolve o pedido esperando, só para o token do Hermes", async () => {
    rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "api_token_check") return { data: args.p_scope === "execucoes:registrar" ? "tok" : null, error: null };
      if (fn === "api_search_request_peek") return { data: { status: "pendente", pedido_id: "p1", qualificados: 30 }, error: null };
      return { data: null, error: { message: "inesperado" } };
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ qualificados: 30 });
  });

  it("token sem permissão não lê", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await GET(req())).status).toBe(403);
  });
});
