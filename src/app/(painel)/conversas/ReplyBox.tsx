"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { sendManualReply } from "./actions";

export type Pending = { key: string; serverId?: string; body: string; at: string; status: "enviando" | "enviada" | "falhou"; error?: string };
type Api = { items: Pending[]; add: (p: Pending) => void; patch: (key: string, p: Partial<Pending>) => void; drop: (key: string) => void };
const Ctx = createContext<Api | null>(null);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/**
 * Mensagens do painel aparecem na hora (otimista) e o status é consultado a cada segundo,
 * sem esperar a atualização geral da tela. `initial` = pendentes que já estão no servidor;
 * `doneIds` = IDs que já chegaram na linha do tempo (aí a versão do servidor assume).
 */
export function ManualProvider({ initial, doneIds, children }: { initial: Pending[]; doneIds: string[]; children: ReactNode }) {
  const router = useRouter();
  const [local, setLocal] = useState<Pending[]>([]);
  const add = useCallback((p: Pending) => setLocal((l) => [...l, p]), []);
  const patch = useCallback((key: string, p: Partial<Pending>) => setLocal((l) => l.map((x) => (x.key === key ? { ...x, ...p } : x))), []);
  const drop = useCallback((key: string) => setLocal((l) => l.filter((x) => x.key !== key)), []);
  const known = new Set(local.map((x) => x.serverId).filter(Boolean));
  const items = [...local, ...initial.filter((p) => !known.has(p.serverId))].filter((p) => !(p.serverId && doneIds.includes(p.serverId)));
  const watching = items.filter((p) => p.serverId && p.status === "enviando").map((p) => `${p.key}|${p.serverId}`).join(",");

  useEffect(() => {
    if (!watching) return;
    let alive = true;
    const tick = async () => {
      for (const entry of watching.split(",")) {
        const [key, id] = entry.split("|");
        try {
          const r = await fetch(`/api/conversas/manual/${id}`, { cache: "no-store" });
          if (!alive || !r.ok) continue;
          const d = (await r.json()) as { status: string; error?: string | null };
          if (d.status === "enviada" || d.status === "falhou") {
            const status = d.status as Pending["status"];
            const error = d.error ?? undefined;
            // Itens vindos do servidor (initial) ainda não existem em `local`: cria a cópia local já concluída.
            setLocal((l) => (l.some((x) => x.key === key)
              ? l.map((x) => (x.key === key ? { ...x, status, error } : x))
              : [...l, { key, serverId: id, body: "", at: new Date().toISOString(), status, error }]));
            router.refresh();
          }
        } catch { /* rede instável: tenta no próximo ciclo */ }
      }
    };
    const timer = window.setInterval(tick, 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [watching, router]);

  return <Ctx.Provider value={{ items, add, patch, drop }}>{children}</Ctx.Provider>;
}

/** Balões das mensagens do painel que ainda não estão na linha do tempo. */
export function PendingBubbles() {
  const api = useContext(Ctx);
  const end = useRef<HTMLLIElement>(null);
  const count = api?.items.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [count]);
  if (!api) return null;
  return <>
    {api.items.filter((p) => p.body).map((p) => (
      <li key={p.key} className="flex justify-end">
        <div className={`max-w-[88%] rounded-lg rounded-tr-none px-3 py-1.5 shadow-sm sm:max-w-[65%] ${p.status === "falhou" ? "bg-rose-900/50" : "bg-[#005c4b] text-[#e9edef]"}`}>
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">Você · painel</p>
          <p className="whitespace-pre-wrap break-words text-sm">{p.body}</p>
          <p className="mt-1 flex items-center justify-end gap-2 text-[10px] text-white/70">
            {p.status === "falhou" && <span className="text-rose-200">Não enviada{p.error ? `: ${p.error}` : ""}</span>}
            {p.status === "falhou" && !p.serverId && <button type="button" className="underline" onClick={() => api.drop(p.key)}>fechar</button>}
            <span>{p.status === "enviando" ? "enviando…" : p.status === "enviada" ? "✓ enviada" : ""}</span>
            <span>{hhmm(p.at)}</span>
          </p>
        </div>
      </li>
    ))}
    <li ref={end} aria-hidden className="h-0" />
  </>;
}

/** Caixa de resposta: limpa e mostra o balão no mesmo instante do envio. */
export function ReplyBox({ leadId, disabled }: { leadId: string; disabled: boolean }) {
  const api = useContext(Ctx);
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  if (disabled) return <p className="border-t border-line px-4 py-3 text-xs text-muted">Sem WhatsApp cadastrado ou lead marcado para não contatar: não é possível responder por aqui.</p>;
  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || !api) return;
    const key = crypto.randomUUID();
    setText("");
    area.current?.focus();
    api.add({ key, body, at: new Date().toISOString(), status: "enviando" });
    const fd = new FormData();
    fd.set("lead_id", leadId);
    fd.set("body", body);
    const r = await sendManualReply({}, fd);
    if (r.error || !r.id) api.patch(key, { status: "falhou", error: r.error ?? "tente novamente" });
    else api.patch(key, { serverId: r.id });
  }
  return (
    <form onSubmit={submit} className="bg-[#202c33] px-3 py-2.5">
      <div className="flex items-end gap-2">
        <textarea ref={area} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={1} aria-label="Mensagem"
          className="max-h-40 min-h-[42px] flex-1 resize-none rounded-lg border-0 bg-[#2a3942] px-3 py-2.5 text-sm text-[#e9edef] outline-none placeholder:text-[#8696a0]" placeholder="Digite uma mensagem"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
        <button disabled={!text.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-lg text-white transition hover:bg-[#06cf9c] disabled:opacity-40" aria-label="Enviar mensagem">➤</button>
      </div>
    </form>
  );
}
