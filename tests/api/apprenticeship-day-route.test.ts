import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.fn();
const authenticate = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ serviceClient: () => ({ rpc }) }));
vi.mock("@/lib/hermes/api", async original => ({
  ...await original<typeof import("@/lib/hermes/api")>(), authenticate,
}));
const { POST } = await import("@/app/api/hermes/v1/aprendizado/dia/route");
const request = (body: unknown) => new Request("http://localhost/api/hermes/v1/aprendizado/dia", { method: "POST", body: JSON.stringify(body) });
describe("daily apprenticeship data", () => {
  beforeEach(() => { rpc.mockReset(); authenticate.mockReset(); authenticate.mockResolvedValue({ tokenId: "token" }); });
  it("returns the database payload without requiring a status field", async () => {
    const data = { day: "2026-10-16", stats: { leads: 1 }, conversations: [{ lead: "Exemplo", events: [] }] };
    rpc.mockResolvedValue({ data, error: null });
    const response = await POST(request({ day: data.day }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("api_apprenticeship_day_data", { p_day: data.day });
  });
  it("preserves authentication, input validation and database failure handling", async () => {
    authenticate.mockResolvedValueOnce({ response: new Response(null, { status: 403 }) });
    expect((await POST(request({ day: "2026-10-16" }))).status).toBe(403);
    expect((await POST(request({ day: "invalid" }))).status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { code: "test" } });
    expect((await POST(request({ day: "2026-10-16" }))).status).toBe(503);
  });
});
