"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/(painel)/leads/actions";
import { reportDispatchError } from "@/lib/dispatch-alerts";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

/** Formulário com estado de envio, erro e sucesso para as ações do painel. */
export function ActionForm({
  action,
  children,
  submit,
  className = "space-y-3",
  variant = "btn-primary",
  confirmText,
  dispatchNotifications = false,
}: {
  action: Action;
  children?: React.ReactNode;
  submit: string;
  className?: string;
  variant?: string;
  confirmText?: string;
  dispatchNotifications?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (previous, form) => {
    try {
      const result = await action(previous, form);
      if (dispatchNotifications && result.error) {
        const recovery = (result as ActionState & { recovery?: "all" | "retry" | "review" }).recovery;
        reportDispatchError(form, result.error, recovery ?? "review");
      }
      return result;
    } catch (error) {
      if (!dispatchNotifications) throw error;
      const message = "Não foi possível confirmar o disparo. Confira o histórico antes de tentar de novo, para evitar duplicidade.";
      reportDispatchError(form, message, "review");
      return { error: message };
    }
  }, {});
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
