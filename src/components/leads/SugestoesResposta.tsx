"use client";

import { useState } from "react";
import type { Sugestao } from "@/lib/envio/sugestoes";

/** Textos prontos para copiar e colar no WhatsApp. Nada é enviado pelo sistema. */
export function SugestoesResposta({ items }: { items: Sugestao[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(s: Sugestao) {
    try {
      await navigator.clipboard.writeText(s.texto);
      setCopied(s.id);
    } catch {
      setCopied(null);
    }
    setTimeout(() => setCopied(null), 2500);
  }
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Sugestões de resposta</h2>
        <p className="text-xs text-muted">Só para copiar. O sistema nunca responde ao cliente; você assume a conversa.</p>
      </div>
      {items.map((s) => (
        <div key={s.id} className="rounded-lg border border-line p-3">
          <div className="mb-1 text-xs font-medium text-muted">{s.titulo}</div>
          <p className="whitespace-pre-wrap text-sm">{s.texto}</p>
          <button type="button" className="btn-ghost mt-2" onClick={() => copy(s)}>
            {copied === s.id ? "Copiado!" : "Copiar"}
          </button>
        </div>
      ))}
    </section>
  );
}
