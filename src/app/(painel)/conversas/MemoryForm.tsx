"use client";

import { useActionState } from "react";
import { saveMemory, type ConversationState } from "./actions";

export type Memory = { summary: string; facts: string; objections: string; next_action: string; updated_at?: string };

export function MemoryForm({ leadId, memory }: { leadId: string; memory: Memory | null }) {
  const [state, action, pending] = useActionState<ConversationState, FormData>(saveMemory, {});
  const fields = [
    { name: "summary", label: "Resumo do atendimento", max: 2000, hint: "O que já conversaram e em que ponto estão." },
    { name: "facts", label: "Fatos confirmados e promessas", max: 3000, hint: "O que o cliente contou e o que você combinou. Não inclua suposições." },
    { name: "objections", label: "Dúvidas e objeções", max: 2000, hint: "Ex.: já usa agenda; precisa falar com o sócio." },
    { name: "next_action", label: "Próxima ação", max: 1000, hint: "O que fazer ou perguntar em seguida." },
  ] as const;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="lead_id" value={leadId} />
      {fields.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="label">{f.label}</label>
          <textarea id={f.name} name={f.name} className="input" rows={f.name === "next_action" ? 2 : 3}
            maxLength={f.max} defaultValue={memory?.[f.name] ?? ""} placeholder={f.hint} />
        </div>
      ))}
      <button disabled={pending} className="btn-primary">{pending ? "Salvando…" : "Salvar memória"}</button>
      {state.error && <p role="alert" className="text-sm text-rose-300">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-emerald-300">{state.ok}</p>}
    </form>
  );
}
