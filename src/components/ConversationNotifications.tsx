"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DISPATCH_ALERT_EVENT, readDispatchAlerts, type DispatchAlert } from "@/lib/dispatch-alerts";
import { DispatchNotification } from "./DispatchNotification";

type Unread = { id: string; business_name: string; last_in_at: string; last_in_body: string | null; last_in_media: string | null };
type SendIssue = { id: string; leadId: string; message: string };
export function ConversationNotifications() {
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = pathname === "/conversas" ? params.get("lead") : null;
  const router = useRouter();
  const [rows, setRows] = useState<Unread[]>([]);
  const [open, setOpen] = useState(false);
  const [dispatchAlerts, setDispatchAlerts] = useState<DispatchAlert[]>([]);
  const [remoteAlerts, setRemoteAlerts] = useState<DispatchAlert[]>([]);
  const [sendIssues, setSendIssues] = useState<SendIssue[]>([]);
  useEffect(() => {
    setDispatchAlerts(readDispatchAlerts());
    const update = () => { const alerts = readDispatchAlerts(); setDispatchAlerts(alerts); if (alerts.length) setOpen(true); };
    window.addEventListener(DISPATCH_ALERT_EVENT, update);
    return () => window.removeEventListener(DISPATCH_ALERT_EVENT, update);
  }, []);
  const [error, setError] = useState("");
  const [permission, setPermission] = useState("default");
  const previous = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    setPermission("Notification" in window ? Notification.permission : "unsupported");
    let disposed = false;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const [response, alertResponse] = await Promise.all([
          fetch("/api/conversas/notificacoes", { cache: "no-store" }),
          fetch("/api/admin/alerts", { cache: "no-store" }),
        ]);
        if (!response.ok) throw Error();
        const data = await response.json();
        if (alertResponse.ok) {
          const saved = await alertResponse.json();
          if (!disposed) { setRemoteAlerts(saved.alerts as DispatchAlert[]); setSendIssues(saved.issues as SendIssue[]); }
        }
        if (disposed) return;
        const incoming = data.conversations as Unread[];
        const fresh = incoming.filter(row => previous.current && previous.current.get(row.id) !== row.last_in_at);
        previous.current = new Map(incoming.map(row => [row.id, row.last_in_at]));
        for (const row of fresh) {
          if (!(selected === row.id && document.visibilityState === "visible")) {
            setOpen(true);
            if ("Notification" in window && Notification.permission === "granted") {
              try {
              const notification = new Notification(`Resposta de ${row.business_name}`, { body: row.last_in_media === "audio" ? "Mensagem de voz" : row.last_in_body ?? "Nova mensagem", tag: row.id });
              notification.onclick = () => { window.focus(); router.push(`/conversas?lead=${row.id}`); notification.close(); };
              } catch { /* In-app notifications still work when the browser blocks desktop alerts. */ }
            }
          }
        }
        if (!disposed) { setRows(incoming); setError(""); }
        if (fresh.length && document.visibilityState === "visible") router.refresh();
      } catch { if (!disposed) setError("Avisos indisponíveis. Tentando reconectar…"); }
      finally { busy = false; }
    };
    void poll();
    const timer = window.setInterval(poll, 5000);
    document.addEventListener("visibilitychange", poll);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [selected, router]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const alerts = [...dispatchAlerts, ...remoteAlerts.filter(remote => !dispatchAlerts.some(local => local.id === remote.id))];
  return <div ref={box} className={`group fixed right-4 top-3 z-50 flex flex-col items-end transition-opacity duration-300 ${open ? "opacity-100" : "opacity-90 hover:opacity-100 focus-within:opacity-100"}`}>
    {open && <section aria-label="Notificações" className="absolute right-0 top-12 max-h-[80vh] w-96 max-w-[90vw] overflow-y-auto rounded-xl border border-white/15 bg-[#202c33] p-4 text-[#e9edef] shadow-xl">
      <div className="mb-3 flex justify-between"><strong>Notificações ({rows.length + alerts.length + sendIssues.length})</strong><button aria-label="Fechar notificações" onClick={() => setOpen(false)}>✕</button></div>
      {alerts.map(alert => <DispatchNotification key={alert.id} alert={alert} onDismiss={id => setRemoteAlerts(current => current.filter(row => row.id !== id))} />)}
      {sendIssues.slice(0,3).map(issue => <div key={issue.id} className="mb-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm"><strong>Problema no envio</strong><p className="mt-1 text-xs">{issue.message}</p><Link href={`/conversas?lead=${issue.leadId}`} className="mt-2 inline-block text-emerald-300">Conferir conversa</Link></div>)}
      {sendIssues.length > 3 && <Link href="/saude" className="mb-2 block text-xs text-amber-200">Mais {sendIssues.length - 3} problemas recentes · Ver saúde do sistema</Link>}
      <div className="max-h-64 overflow-y-auto">{rows.map(row => <Link className="block border-b border-white/10 py-2" key={row.id} href={`/conversas?lead=${row.id}`} onClick={() => setOpen(false)}><span className="block text-sm font-semibold">{row.business_name}</span><span className="block truncate text-xs text-[#aebac1]">{row.last_in_media === "audio" ? "Mensagem de voz" : row.last_in_body ?? "Nova mensagem"}</span></Link>)}{!rows.length && <p className="text-sm">Nenhuma resposta não lida.</p>}</div>
      {rows.length > 0 && <button className="mt-3 block text-sm text-emerald-300" onClick={async () => {
        const batch = rows;
        const results = await Promise.all(batch.map(row => fetch("/api/conversas/notificacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_id: row.id, seen_at: row.last_in_at }) }).then(r => r.ok).catch(() => false)));
        if (results.every(Boolean)) { setRows([]); setError(""); router.refresh(); } else setError("Não foi possível marcar todas como lidas.");
      }}>✓ Marcar todas como lidas</button>}
      {permission === "default" && <button className="mt-3 text-sm text-emerald-300" onClick={async () => { try { setPermission(await Notification.requestPermission()); } catch { setError("Não foi possível ativar os avisos do navegador."); } }}>Ativar notificações do navegador</button>}
      {permission === "denied" && <p className="mt-2 text-xs">Avisos do navegador bloqueados. Você pode liberá-los nas configurações do site.</p>}
      {error && <p role="status" className="mt-2 text-xs text-amber-300">{error}</p>}
    </section>}
    <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${rows.length} conversas com respostas não lidas; ${alerts.length} avisos de disparo; ${sendIssues.length} problemas de envio${error ? ". Avisos indisponíveis" : ""}`} className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[#005c4b] text-sm font-semibold text-white shadow-lg">{error || alerts.length || sendIssues.length ? "⚠" : "🔔"}<span className="sr-only">Notificações</span> {rows.length + alerts.length + sendIssues.length > 0 && <span aria-live="polite" className="absolute -right-2 -top-2 rounded-full bg-emerald-400 px-1.5 py-0.5 text-[10px] text-black">{rows.length + alerts.length + sendIssues.length}</span>}</button>
  </div>;
}
