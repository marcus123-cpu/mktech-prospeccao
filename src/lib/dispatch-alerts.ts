import { z } from "zod";

export const DISPATCH_ALERT_EVENT = "mktech:dispatch-alerts";
const KEY = "mktech:dispatch-alerts:v1";
const schema = z.object({
  id: z.uuid(), message: z.string().max(2000), createdAt: z.string(),
  recovery: z.enum(["all", "retry", "review"]),
  scope: z.enum(["selected", "all"]), today: z.string().max(20),
  leads: z.array(z.uuid()).max(5000),
});
export type DispatchAlert = z.infer<typeof schema>;
let fallback: DispatchAlert[] = [];

// Session storage keeps the warning across navigation/reloads in this tab.
// No message bodies, names or phone numbers are stored.
export function readDispatchAlerts(): DispatchAlert[] {
  try {
    const result = z.array(schema).max(20).safeParse(JSON.parse(sessionStorage.getItem(KEY) ?? "[]"));
    return result.success ? result.data : fallback;
  } catch { return fallback; }
}
export function writeDispatchAlerts(rows: DispatchAlert[]) {
  fallback = rows.slice(0, 20);
  try { sessionStorage.setItem(KEY, JSON.stringify(fallback)); } catch { /* In-memory alerts still work. */ }
  window.dispatchEvent(new Event(DISPATCH_ALERT_EVENT));
}
export async function persistDispatchAlert(alert: DispatchAlert) {
  try { await fetch("/api/admin/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(alert) }); }
  catch { /* A cópia local continua visível se a rede cair. */ }
}
export async function dismissDispatchAlert(id: string) {
  try { await fetch("/api/admin/alerts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); }
  catch { /* O aviso local já foi removido. */ }
}
export function reportDispatchError(form: FormData, message: string, recovery: DispatchAlert["recovery"]) {
  const parsed = schema.safeParse({ id: crypto.randomUUID(), message: message.slice(0, 2000), createdAt: new Date().toISOString(), recovery,
    scope: form.get("scope") === "all" ? "all" : "selected", today: String(form.get("today") ?? "").slice(0, 20), leads: form.getAll("lead_ids").filter(value => z.uuid().safeParse(value).success).slice(0, 5000) });
  if (parsed.success) { writeDispatchAlerts([parsed.data, ...readDispatchAlerts()]); void persistDispatchAlert(parsed.data); }
}
