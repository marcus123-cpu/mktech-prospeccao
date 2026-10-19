"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

// Mantém o painel em dia sem recarregar. Cada refresh refaz TODAS as consultas da tela no servidor,
// então só as telas que mudam sozinhas atualizam, e na velocidade que faz sentido para elas.
// Conversas usa um marcador leve (/api/conversas/versao) e só recarrega quando algo mudou de verdade.
const LIVE: [string, number][] = [
  ["/conversas", 3000],
  ["/envio", 10000],
  ["/conexao", 10000],
  ["/disparo", 20000],
  ["/hermes", 20000],
  ["/execucoes", 20000],
  ["/funil", 30000],
  ["/retornos", 60000],
  ["/analise", 60000],
];

function intervalFor(pathname: string): number | null {
  if (pathname === "/") return 30000;
  return LIVE.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? null;
}

export function AutoRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const every = intervalFor(pathname);
    if (every === null) return; // leads, configurações etc.: só mudam quando você mexe
    const conversations = pathname.startsWith("/conversas");
    let busy = false;
    let active = true;
    let version: string | null = null;
    let hiddenAt = 0;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || busy) return;
      if (!conversations) { router.refresh(); return; }
      busy = true;
      try {
        const r = await fetch("/api/conversas/versao", { cache: "no-store" });
        if (!r.ok || !active) return;
        const next = JSON.stringify(await r.json());
        if (version !== null && version !== next) router.refresh();
        version = next;
      } catch { /* Retry after temporary network failure. */ } finally { busy = false; }
    };
    // Ao voltar para a aba só atualiza se ficou fora um tempo; nunca ao abrir a tela (a navegação já trouxe os dados novos).
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 10000) void refresh();
      hiddenAt = 0;
    };
    const timer = window.setInterval(refresh, every);
    document.addEventListener("visibilitychange", onVisibility);
    if (conversations) void refresh(); // só lê o marcador, para detectar mudanças a partir daqui
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, pathname]);
  return null;
}
