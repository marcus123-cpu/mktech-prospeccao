"use client";
import { useEffect } from "react";

export function SeenConversation({ leadId, at, explicit }: { leadId: string; at: string | null; explicit: boolean }) {
  useEffect(() => {
    if (!at) return;
    let done = false;
    let busy = false;
    const mark = async () => {
      if (done || busy || document.visibilityState !== "visible" || (!explicit && !window.matchMedia("(min-width: 768px)").matches)) return;
      busy = true;
      try {
        const response = await fetch("/api/conversas/notificacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_id: leadId, seen_at: at }) });
        done = response.ok;
      } catch { /* Retry while this conversation remains visible. */ }
      finally { busy = false; }
    };
    void mark();
    const timer = window.setInterval(mark, 5000);
    document.addEventListener("visibilitychange", mark);
    return () => { done = true; clearInterval(timer); document.removeEventListener("visibilitychange", mark); };
  }, [leadId, at, explicit]);
  return null;
}
