"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { SITE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; ok?: string };

const loginSchema = z.object({
  email: z.email("e-mail inválido").max(200),
  password: z.string().min(1, "informe a senha").max(200),
});

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "E-mail ou senha incorretos." };
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) {
    await supabase.auth.signOut();
    return { error: "Esta conta não tem acesso ao painel." };
  }
  redirect("/");
}

export async function requestReset(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.email().max(200).safeParse(form.get("email"));
  if (!parsed.success) return { error: "E-mail inválido." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${SITE_URL}/auth/callback?next=/redefinir-senha`,
  });
  // Mesma resposta exista ou não a conta, para não revelar e-mails cadastrados.
  return { ok: "Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha." };
}

export async function updatePassword(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 10) return { error: "Use pelo menos 10 caracteres." };
  if (password !== confirm) return { error: "As senhas não conferem." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Não foi possível alterar a senha. Abra o link do e-mail novamente." };
  redirect("/");
}
