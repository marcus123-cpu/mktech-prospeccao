"use client";

import { useState } from "react";

/** Copia o resumo completo do lead (dados, diagnóstico, evidências, envio). */
export function CopyResumo({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "ok" | "erro">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      // Sem permissão de área de transferência (alguns celulares): seleção manual.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      setState(ok ? "ok" : "erro");
    }
    setTimeout(() => setState("idle"), 2500);
  }
  return (
    <button type="button" className="btn-ghost" onClick={copy}>
      {state === "ok" ? "Copiado!" : state === "erro" ? "Não deu para copiar" : "Copiar diagnóstico"}
    </button>
  );
}
