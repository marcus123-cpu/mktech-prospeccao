"use client";

import { useActionState } from "react";
import { removeFromQueue, type FunilState } from "./actions";

/** Cancela a saudação que ainda não saiu e tira o lead da fila de envio. */
export function RemoveFromQueueButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState<FunilState, FormData>(removeFromQueue, {});
  return (
    <form
      action={action}
      className="mt-2"
      onSubmit={(e) => {
        if (!confirm(`Tirar "${name}" da fila? A mensagem ainda não enviada é cancelada e o lead volta a ficar disponível para disparar.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="btn-ghost w-full text-xs text-amber-200" disabled={pending}>{pending ? "…" : "⛔ Tirar da fila de envio"}</button>
      {state.error && <span role="alert" className="text-xs text-rose-300">{state.error}</span>}
    </form>
  );
}
