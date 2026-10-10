"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Mantém o painel em dia sem recarregar: reconsulta os dados da tela a cada
// poucos segundos (só com a aba visível) e assim que a aba volta ao foco.
const INTERVAL_MS = 8000;

export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
