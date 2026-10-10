"use client";

import { useActionState } from "react";
import { AuthCard } from "@/components/AuthCard";
import { updatePassword, type FormState } from "../login/actions";

export default function NewPasswordPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePassword, {});
  return (
    <AuthCard title="Criar nova senha">
      <form action={action} className="space-y-4">
        <div>
          <label className="label" htmlFor="password">Nova senha</label>
          <input className="input" id="password" name="password" type="password" minLength={10} autoComplete="new-password" required />
        </div>
        <div>
          <label className="label" htmlFor="confirm">Repita a senha</label>
          <input className="input" id="confirm" name="confirm" type="password" minLength={10} autoComplete="new-password" required />
        </div>
        {state.error && <p role="alert" className="text-sm text-rose-300">{state.error}</p>}
        <button className="btn-primary w-full" disabled={pending}>{pending ? "Salvando…" : "Salvar senha"}</button>
      </form>
    </AuthCard>
  );
}
