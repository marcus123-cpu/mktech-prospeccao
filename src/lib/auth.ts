import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Garante usuário logado e cadastrado em app_admins. Retorna o cliente com a sessão dele. */
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error || !isAdmin) redirect("/login?erro=sem-permissao");
  return { supabase, user };
}

/** Mensagem de erro do Postgres/Supabase em português, sem detalhes internos. */
export function dbErrorMessage(error: { message?: string; code?: string } | null): string {
  if (!error) return "";
  if (error.code === "42501") return "Acesso negado.";
  if (error.code === "22023" || error.code === "P0001") return error.message ?? "Dados inválidos.";
  if (error.code === "23505") return "Já existe um registro com esses dados.";
  return "Não foi possível concluir a operação. Tente novamente.";
}
