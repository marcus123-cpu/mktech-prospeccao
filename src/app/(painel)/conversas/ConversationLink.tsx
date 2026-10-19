"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentProps } from "react";

type Menu = { x: number; y: number };

/**
 * Linha da lista de conversas. Botão direito (ou segurar o dedo) abre "Marcar como não lida / lida",
 * igual ao WhatsApp. Também pré-carrega só quando o mouse chega, para não pedir todas as conversas de uma vez.
 */
export function ConversationLink({ leadId, name, active, isUnread, lastInAt, children, ...props }: ComponentProps<typeof Link> & { leadId: string; name: string; active: boolean; isUnread: boolean; lastInAt: string | null }) {
  const router = useRouter();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState("");
  const press = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!(e instanceof PointerEvent && box.current?.contains(e.target as Node))) setMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [menu]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(""), 4000);
    return () => window.clearTimeout(timer);
  }, [error]);

  async function toggle() {
    setMenu(null);
    setError("");
    const body = isUnread ? { lead_id: leadId, seen_at: lastInAt } : { lead_id: leadId, unread: true };
    try {
      const response = await fetch("/api/conversas/notificacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { setError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "Não foi possível alterar."); return; }
      router.refresh();
    } catch { setError("Sem conexão. Tente de novo."); }
  }

  const open = (x: number, y: number) => setMenu({ x: Math.min(x, window.innerWidth - 230), y: Math.min(y, window.innerHeight - 90) });

  return <>
    <Link {...props} prefetch={false}
      onContextMenu={event => { event.preventDefault(); open(event.clientX, event.clientY); }}
      onTouchStart={event => { const t = event.touches[0]; press.current = window.setTimeout(() => open(t.clientX, t.clientY), 550); }}
      onTouchEnd={() => { if (press.current) window.clearTimeout(press.current); }}
      onTouchMove={() => { if (press.current) window.clearTimeout(press.current); }}
      onClick={event => {
        if (!active && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
          window.dispatchEvent(new CustomEvent("mktech:conversation-opening", { detail: { id: leadId, name } }));
        }
      }}>{children}</Link>
    {menu && <div ref={box} role="menu" aria-label={`Ações da conversa com ${name}`} style={{ left: menu.x, top: menu.y }}
      className="fixed z-[70] w-56 overflow-hidden rounded-xl border border-white/10 bg-[#233138] py-1 text-sm text-[#e9edef] shadow-2xl">
      <button role="menuitem" onClick={toggle} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10">
        <span aria-hidden>{isUnread ? "✓" : "●"}</span>{isUnread ? "Marcar como lida" : "Marcar como não lida"}
      </button>
    </div>}
    {error && <p role="alert" className="fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-rose-900 px-4 py-2 text-sm text-white shadow-xl">{error}</p>}
  </>;
}
