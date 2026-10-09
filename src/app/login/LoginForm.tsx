"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, type FormState } from "./actions";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-4">
      {notice && <p className="rounded-lg bg-amber-950/60 p-3 text-sm text-amber-200">{notice}</p>}
      <div>
        <label className="label" htmlFor="email">E-mail</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Senha</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error && <p role="alert" className="text-sm text-rose-300">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
      <Link href="/recuperar-senha" className="block text-center text-sm text-muted hover:text-slate-200">
        Esqueci minha senha
      </Link>
    </form>
  );
}
