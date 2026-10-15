"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Abre a conversa já na mensagem mais recente, como no WhatsApp. */
export function ChatScroll({ children, deps }: { children: ReactNode; deps: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [deps]);
  return <div ref={ref} className="max-h-[62vh] min-h-64 overflow-y-auto bg-panel-2/40 p-4" aria-label="Histórico da conversa">{children}</div>;
}
