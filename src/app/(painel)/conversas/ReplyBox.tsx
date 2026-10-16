"use client";

import { useActionState, useEffect, useRef } from "react";
import { sendManualReply, type ConversationState } from "./actions";

/** Resposta de texto enviada pelo WhatsApp do chip direto do painel. */
export function ReplyBox({ leadId, disabled }: { leadId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<ConversationState, FormData>(sendManualReply, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) form.current?.reset(); }, [state]);
  if (disabled) return <p className="border-t border-line px-4 py-3 text-xs text-muted">Sem WhatsApp cadastrado ou lead marcado para não contatar: não é possível responder por aqui.</p>;
  return (
    <form ref={form} action={action} className="border-t border-line p-3">
      <input type="hidden" name="lead_id" value={leadId} />
      <div className="flex items-end gap-2">
        <textarea name="body" required maxLength={1000} rows={2} className="input min-h-[44px] flex-1 resize-y" aria-label="Mensagem"
          placeholder="Responder pelo WhatsApp… (Ctrl+Enter envia)"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <button disabled={pending} className="btn-primary shrink-0">{pending ? "Enviando…" : "Enviar"}</button>
      </div>
      {state.error && <p role="alert" className="mt-2 text-sm text-rose-300">{state.error}</p>}
      {state.ok && <p role="status" className="mt-2 text-sm text-emerald-300">{state.ok}</p>}
    </form>
  );
}
