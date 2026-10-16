"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const KEY = "mktech:conversas:info";
const Ctx = createContext<{ open: boolean; toggle: () => void }>({ open: false, toggle: () => {} });

/** Três colunas: lista, conversa e painel de informações que abre e fecha (lembra a escolha). */
export function ChatShell({ list, chat, info }: { list: ReactNode; chat: ReactNode; info: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      setOpen(saved === null ? window.innerWidth >= 1280 : saved === "1");
    } catch { setOpen(window.innerWidth >= 1280); }
  }, []);
  const toggle = () => setOpen((v) => {
    try { localStorage.setItem(KEY, v ? "0" : "1"); } catch { /* sem armazenamento */ }
    return !v;
  });
  return (
    <Ctx.Provider value={{ open, toggle }}>
      <div className={`grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)] ${open ? "xl:grid-cols-[300px_minmax(0,1fr)_340px]" : ""}`}>
        {list}
        {chat}
        {open && info}
      </div>
    </Ctx.Provider>
  );
}

export function InfoToggle() {
  const { open, toggle } = useContext(Ctx);
  return (
    <button type="button" onClick={toggle} aria-pressed={open} aria-label={open ? "Fechar informações do lead" : "Abrir informações do lead"}
      className={`btn-ghost ${open ? "border-accent/60 text-white" : ""}`}>
      {open ? "Fechar informações ✕" : "ℹ️ Informações do lead"}
    </button>
  );
}
