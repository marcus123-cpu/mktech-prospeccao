"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";

export type TokenState = { error?: string; ok?: string; token?: string };

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((s) => s.slice(0, 120));

const settingsSchema = z.object({
  daily_target: z.coerce.number().int().min(1).max(100),
  max_run_minutes: z.coerce.number().int().min(5).max(240),
  max_searches: z.coerce.number().int().min(1).max(500),
  max_cost_usd: z.coerce.number().min(0).max(1000),
});

export async function saveSettings(_: TokenState, form: FormData): Promise<TokenState> {
  const { supabase } = await requireAdmin();
  const parsed = settingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revise os limites: meta de 1 a 100, tempo de 5 a 240 min, pesquisas de 1 a 500." };
  const cities = lines(form.get("cities"));
  const niches = lines(form.get("niches"));
  if (!cities.length || !niches.length) return { error: "Informe pelo menos uma cidade e um nicho." };
  const { error } = await supabase.rpc("admin_update_settings", {
    p: { ...parsed.data, cities, niches, routine_enabled: form.get("routine_enabled") === "on" },
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/configuracoes");
  return { ok: "Configurações salvas." };
}

export async function createToken(_: TokenState, form: FormData): Promise<TokenState> {
  const { supabase } = await requireAdmin();
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Dê um nome ao token." };
  const { data, error } = await supabase.rpc("admin_create_integration_token", { p_name: name });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/configuracoes");
  return { ok: "Token criado. Copie agora: ele não será mostrado de novo.", token: (data as { token: string }).token };
}

export async function revokeToken(_: TokenState, form: FormData): Promise<TokenState> {
  const { supabase } = await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Token inválido." };
  const { error } = await supabase.rpc("admin_revoke_integration_token", { p_id: id.data });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/configuracoes");
  return { ok: "Token revogado." };
}
