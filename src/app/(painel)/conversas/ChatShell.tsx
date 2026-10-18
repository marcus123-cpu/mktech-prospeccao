"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const KEY = "mktech:conversas:info:v2";
const Ctx = createContext<{ open: boolean; toggle: () => void }>({ open: false, toggle: () => {} });

/** Três colunas: lista, conversa e painel de informações que abre e fecha (lembra a escolha). */
export function ChatShell({ list, chat, info, selected = false, selectedId }: { list: ReactNode; chat: ReactNode; info: ReactNode; selected?: boolean; selectedId?: string }) {
  const [open, setOpen] = useState(false);
  const [opening,setOpening]=useState<{id:string;name:string}|null>(null);
  useEffect(()=>{
    const start=(event:Event)=>{
      const detail=(event as CustomEvent<{id:string;name:string}>).detail;
      if(detail?.id&&detail.id!==selectedId)setOpening(detail);
    };
    window.addEventListener("mktech:conversation-opening",start);
    return()=>window.removeEventListener("mktech:conversation-opening",start);
  },[selectedId]);
  useEffect(()=>{setOpening(null);},[selectedId]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      setOpen(saved === "1");
    } catch { /* Details are closed by default. */ }
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const toggle = () => setOpen((v) => {
    try { localStorage.setItem(KEY, v ? "0" : "1"); } catch { /* sem armazenamento */ }
    return !v;
  });
  return (
    <Ctx.Provider value={{ open, toggle }}>
      <div className="relative flex h-full min-h-0 overflow-hidden bg-[#111b21]">
        <div className={`${selected || opening ? "hidden" : "flex"} h-full min-h-0 w-full shrink-0 flex-col border-r border-white/5 md:flex md:w-[280px] lg:w-[340px] xl:w-[380px]`}>{list}</div>
        <div aria-busy={!!opening} className={`${selected || opening ? "flex" : "hidden"} relative h-full min-h-0 min-w-0 flex-1 flex-col md:flex`}>
          {opening ? <div role="status" className="absolute inset-0 z-10 flex flex-col bg-[#0b141a]"><header className="flex h-16 shrink-0 items-center border-b border-white/5 bg-[#202c33] px-5 pr-16 text-sm font-medium">{opening.name}</header><div className="flex flex-1 items-center justify-center gap-3 text-sm text-[#aebac1]"><span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400"/>Abrindo conversa…</div></div> : null}
          {chat}
        </div>
        {open && info && <section aria-label="Informações do contato" className="absolute inset-y-0 right-0 z-20 w-[min(340px,100%)] overflow-y-auto border-l border-white/10 bg-[#111b21] shadow-2xl 2xl:static 2xl:w-[340px] 2xl:shrink-0 2xl:shadow-none">
          <div className="flex h-16 items-center justify-between border-b border-white/5 px-4 text-sm font-medium">
            Informações do contato
            <button type="button" aria-label="Fechar informações do lead" onClick={toggle} className="mr-12 flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-white">✕</button>
          </div>
          <div className="p-4">{info}</div>
        </section>}
      </div>
    </Ctx.Provider>
  );
}

export function InfoToggle() {
  const { open, toggle } = useContext(Ctx);
  return (
    <button type="button" onClick={toggle} aria-pressed={open} aria-label={open ? "Fechar informações do lead" : "Abrir informações do lead"}
      title={open ? "Fechar informações do lead" : "Informações do lead"}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10 ${open ? "bg-white/10 text-[#00a884]" : "text-[#aebac1]"}`}>
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1" /></svg>
    </button>
  );
}
