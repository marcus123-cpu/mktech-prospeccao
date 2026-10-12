"use client";

import { useActionState, useState } from "react";
import { cancelSearch, requestSearch, type PedidoState } from "./actions";

/** "Buscar N leads qualificados": o limite de buscas sai sozinho (15 por lead, de 150 a 500). */
export function RequestSearchForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<PedidoState, FormData>(requestSearch, {});
  const [n, setN] = useState(30);
  const buscas = Math.min(500, Math.max(150, n * 15));
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Quantos leads qualificados?</span>
        <input
          name="quantidade"
          type="number"
          min={1}
          max={100}
          value={n}
          onChange={(e) => setN(Number(e.target.value) || 0)}
          className="input w-28"
          disabled={disabled || pending}
        />
      </label>
      <button className="btn-primary" disabled={disabled || pending || n < 1 || n > 100}>
        {pending ? "Enviando…" : "🔎 Buscar"}
      </button>
      <span className="text-xs text-muted">até {buscas} buscas</span>
      {state.error && <p role="alert" className="w-full text-xs text-rose-300">{state.error}</p>}
      {state.ok && <p className="w-full text-xs text-emerald-300">{state.ok}</p>}
    </form>
  );
}

export function CancelSearchButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<PedidoState, FormData>(cancelSearch, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button className="btn-ghost text-xs" disabled={pending}>{pending ? "…" : "Cancelar pedido"}</button>
      {state.error && <span role="alert" className="text-xs text-rose-300">{state.error}</span>}
    </form>
  );
}
