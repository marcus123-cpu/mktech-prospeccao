import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, requireAdmin } = vi.hoisted(() => ({ rpc: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin, dbErrorMessage: (error: {message: string}) => error.message }));
import { startDispatch } from "@/app/(painel)/disparo/actions";

function form(scope = "selected") { const value = new FormData(); value.set("scope", scope); value.set("today", "10"); return value; }
describe("dispatch recovery", () => {
  beforeEach(() => { vi.clearAllMocks(); requireAdmin.mockResolvedValue({ supabase: { rpc } }); });
  it("offers an explicit all-leads recovery for an empty selection without sending", async () => {
    expect(await startDispatch({}, form())).toMatchObject({ recovery: "all", error: expect.stringContaining("Nenhum lead") });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not silently replace an invalid selection with all leads", async () => {
    const value = form(); value.append("lead_ids", "invalid");
    expect(await startDispatch({}, value)).toMatchObject({ recovery: "review" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("revalidates the daily limit on recovery", async () => {
    const value = form("all"); value.set("today", "201");
    expect(await startDispatch({}, value)).toHaveProperty("error"); expect(rpc).not.toHaveBeenCalled();
  });
  it("only allows direct retry after a rolled-back business rejection", async () => {
    rpc.mockResolvedValue({ error: { code: "22023", message: "Canal desligado" } });
    expect(await startDispatch({}, form("all"))).toMatchObject({ recovery: "retry", error: "Canal desligado" });
  });
  it("requires reviewing uncertain outcomes instead of offering a blind retry", async () => {
    rpc.mockResolvedValue({ error: { code: "", message: "Failed to fetch" } });
    expect(await startDispatch({}, form("all"))).toMatchObject({ recovery: "review" });
  });
  it("keeps the protected dispatch RPC and greeting-only mode on an explicit recovery", async () => {
    rpc.mockResolvedValue({ data: { added: 3 }, error: null });
    expect(await startDispatch({}, form("all"))).toHaveProperty("ok");
    expect(rpc).toHaveBeenCalledWith("admin_dispatch_start", expect.objectContaining({ p_all: true, p_leads: null, p_today: 10, p_bot: false }));
  });
  it("authenticates even empty/invalid requests", async () => {
    requireAdmin.mockRejectedValue(new Error("Unauthorized"));
    await expect(startDispatch({}, form())).rejects.toThrow("Unauthorized");
    expect(rpc).not.toHaveBeenCalled();
  });
});
