"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/(painel)/leads/actions";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

/** Formulário com estado de envio, erro e sucesso para as ações do painel. */
export function ActionForm({
  action,
  children,
  submit,
  className = "space-y-3",
  variant = "btn-primary",
  confirmText,
}: {
  action: Action;
  children?: React.ReactNode;
  submit: string;
  className?: string;
  variant?: string;
  confirmText?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className={variant} disabled={pending}>{pending ? "Salvando…" : submit}</button>
        {state.error && <span role="alert" className="text-sm text-rose-300">{state.error}</span>}
        {state.ok && <span className="text-sm text-emerald-300">{state.ok}</span>}
      </div>
    </form>
  );
}
