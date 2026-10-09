"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AuthCard } from "@/components/AuthCard";
import { requestReset, type FormState } from "../login/actions";

export default function ResetPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(requestReset, {});
  return (
    <AuthCard title="Recuperar senha">
      <form action={action} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input className="input" id="email" name="email" type="email" required />
        </div>
        {state.error && <p role="alert" className="text-sm text-rose-300">{state.error}</p>}
        {state.ok && <p className="text-sm text-emerald-300">{state.ok}</p>}
        <button className="btn-primary w-full" disabled={pending}>{pending ? "Enviando…" : "Enviar link"}</button>
        <Link href="/login" className="block text-center text-sm text-muted hover:text-slate-200">Voltar ao login</Link>
      </form>
    </AuthCard>
  );
}
