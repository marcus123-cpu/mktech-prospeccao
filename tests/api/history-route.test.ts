import { describe, it, expect, vi, beforeEach } from "vitest";
const rpc = vi.fn();
const authenticate = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ serviceClient: () => ({ rpc }) }));
vi.mock("@/lib/hermes/api", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/hermes/api")>(), authenticate,
}));
const { POST } = await import("@/app/api/hermes/v1/envio/historico/route");
const message = { telefone: "+5517998764321", message_id: "wa-old-1", direcao: "entrada", texto: "Antiga", tipo: "texto", ocorrida_em: "2026-01-01T12:00:00Z" };
const req = (body: unknown) => new Request("http://localhost/api/hermes/v1/envio/historico", { method: "POST", body: JSON.stringify(body) });
describe("historical import endpoint", () => {
  beforeEach(() => { rpc.mockReset(); authenticate.mockReset(); authenticate.mockResolvedValue({ tokenId: "token" }); });
  it("uses only the history RPC with original data", async () => {
    rpc.mockResolvedValue({ data: { status: "registrada" }, error: null });
    expect((await POST(req(message))).status).toBe(201);
    expect(authenticate).toHaveBeenCalledWith(expect.any(Request), "envio:operar");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("api_conversation_history", { p: message });
  });
  it("rejects unauthenticated callers before persistence", async () => {
    authenticate.mockResolvedValue({ response: new Response(null, { status: 403 }) });
    expect((await POST(req(message))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid dates and retries database failure", async () => {
    expect((await POST(req({ ...message, ocorrida_em: "bad" }))).status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { code: "test" } });
    expect((await POST(req(message))).status).toBe(503);
  });
});
