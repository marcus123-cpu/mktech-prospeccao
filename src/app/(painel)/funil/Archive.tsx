"use client";

import { useActionState } from "react";
import { archiveFromFunnel, type FunilState } from "./actions";

/** Tira o atendimento do funil (ou devolve). Não apaga nada. */
export function ArchiveButton({ id, name, archived }: { id: string; name: string; archived: boolean }) {
  const [state, action, pending] = useActionState<FunilState, FormData>(archiveFromFunnel, {});
  return (
    <form
      action={action}
      className="mt-2"
      onSubmit={(e) => {
        if (!archived && !confirm(`Tirar "${name}" do funil? Nada é apagado: fica em Arquivados e você pode voltar.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="archived" value={archived ? "0" : "1"} />
      <button className="btn-ghost w-full text-xs text-muted" disabled={pending}>
        {pending ? "…" : archived ? "↩ Voltar ao funil" : "🗑 Tirar do funil"}
      </button>
      {state.error && <span role="alert" className="text-xs text-rose-300">{state.error}</span>}
    </form>
  );
}
