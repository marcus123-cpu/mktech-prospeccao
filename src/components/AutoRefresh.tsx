"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

// Mantém o painel em dia sem recarregar: reconsulta os dados da tela a cada
// poucos segundos (só com a aba visível) e assim que a aba volta ao foco.
const INTERVAL_MS = 8000;

export function AutoRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    let busy = false;
    let active = true;
    let version: string | null = null;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || busy) return;
      if (!pathname.startsWith("/conversas")) { router.refresh(); return; }
      busy = true;
      try {
        const r = await fetch("/api/conversas/versao", { cache: "no-store" });
        if (!r.ok || !active) return;
        const next = JSON.stringify(await r.json());
        if (version !== null && version !== next) router.refresh();
        version = next;
      } catch { /* Retry after temporary network failure. */ } finally { busy = false; }
    };
    const timer = window.setInterval(refresh, pathname.startsWith("/conversas") ? 2000 : INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    void refresh();
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, pathname]);
  return null;
}
