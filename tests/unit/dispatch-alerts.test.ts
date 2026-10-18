import { beforeEach, expect, it, vi } from "vitest";
import { readDispatchAlerts, reportDispatchError, writeDispatchAlerts } from "@/lib/dispatch-alerts";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  writeDispatchAlerts([]);
});
it("retains errors across reads and announces updates to the bell", () => {
  const form = new FormData(); form.set("scope", "selected"); form.set("today", "10");
  reportDispatchError(form, "Lista vazia", "all");
  expect(readDispatchAlerts()).toMatchObject([{ message: "Lista vazia", recovery: "all", leads: [] }]);
  expect(window.dispatchEvent).toHaveBeenCalled();
  writeDispatchAlerts([]); expect(readDispatchAlerts()).toEqual([]);
});
it("reports malformed fields without retaining arbitrary form data", () => {
  const form = new FormData(); form.set("scope", "bad"); form.append("lead_ids", "bad"); form.set("private", "secret");
  reportDispatchError(form, "Lista inválida", "review");
  expect(readDispatchAlerts()).toMatchObject([{ recovery: "review", leads: [] }]);
  expect(JSON.stringify(readDispatchAlerts())).not.toContain("secret");
});
it("still delivers the alert when browser storage is unavailable", () => {
  vi.stubGlobal("sessionStorage", { getItem() { throw Error(); }, setItem() { throw Error(); } });
  const form = new FormData(); form.set("scope", "all"); form.set("today", "5");
  reportDispatchError(form, "Conexão indisponível", "review");
  expect(readDispatchAlerts()[0].message).toBe("Conexão indisponível");
});
