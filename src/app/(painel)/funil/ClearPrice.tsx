"use client";

import { useActionState } from "react";
import { clearPriceQuestion, type FunilState } from "./actions";

export function ClearPriceButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FunilState, FormData>(clearPriceQuestion, {});
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="id" value={id} />
      <button className="btn-ghost w-full text-xs" disabled={pending}>{pending ? "…" : "Já respondi o valor"}</button>
      {state.error && <span role="alert" className="text-xs text-rose-300">{state.error}</span>}
    </form>
  );
}
