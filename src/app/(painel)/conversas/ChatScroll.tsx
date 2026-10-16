"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Abre a conversa já na mensagem mais recente, como no WhatsApp. */
export function ChatScroll({ children, deps }: { children: ReactNode; deps: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [deps]);
  return <div ref={ref} className="chat-wallpaper min-h-0 flex-1 overflow-y-auto overscroll-contain px-[5%] py-5" aria-label="Histórico da conversa">{children}</div>;
}
