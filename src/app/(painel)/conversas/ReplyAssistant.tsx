"use client";

import { useState, useTransition } from "react";
import { suggestReply } from "./actions";
import type { ReplyDraft } from "@/lib/conversation-draft";

export function ReplyAssistant({ leadId }: { leadId: string }) {
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function generate() {
    setError(""); setCopied(false);
    startTransition(async () => {
      const result = await suggestReply(leadId);
      if ("error" in result) { setError(result.error); return; }
      setDraft(result.draft);
      setReply(result.draft.reply);
    });
  }

  return <section className="card space-y-3 p-4">
    <div><h2 className="font-semibold">Ajuda para responder</h2><p className="text-xs text-muted">Gere um rascunho com o contexto da conversa. Você revisa e envia pelo WhatsApp.</p></div>
    <button type="button" className="btn-primary" disabled={pending} onClick={generate}>{pending ? "Preparando..." : draft ? "Gerar outra sugestão" : "Sugerir resposta"}</button>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {draft && <>
      <p className="text-xs text-muted">{draft.mode === "ia" ? "Sugestão por IA" : "Modelo de resposta"} · revise antes de usar</p>
      <p className="text-sm"><strong>Intenção:</strong> {draft.intent}</p>
      <label className="label" htmlFor="suggested-reply">Resposta editável</label>
      <textarea id="suggested-reply" className="input min-h-32" maxLength={1000} value={reply} onChange={(e) => { setReply(e.target.value); setCopied(false); }} />
      <p className="text-sm"><strong>Próxima ação:</strong> {draft.next_action}</p>
      <button type="button" className="btn-ghost" disabled={!reply.trim()} onClick={async () => {
        try { await navigator.clipboard.writeText(reply.trim()); setCopied(true); }
        catch { setError("Não foi possível copiar. Selecione o texto manualmente."); }
      }}>{copied ? "Copiado" : "Copiar resposta"}</button>
    </>}
  </section>;
}
