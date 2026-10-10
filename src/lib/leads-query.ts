import type { SupabaseClient } from "@supabase/supabase-js";
import { OFFERS, ORIGINS, PRIORITIES, SITE_STATUSES, STAGES } from "@/lib/labels";

export type LeadFilters = {
  q?: string;
  cidade?: string;
  etapa?: string;
  prioridade?: string;
  origem?: string;
  site?: string;
  nao_contatados?: string;
  oferta?: string;
  de?: string;
  ate?: string;
  ordem?: string;
  pagina?: string;
};

export const PAGE_SIZE = 50;

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Aplica filtros da URL a uma consulta de leads. Valores fora das listas conhecidas são ignorados. */
export function applyLeadFilters<Q extends { [k: string]: any }>(query: Q, f: LeadFilters): Q {
  let q: any = query;
  const term = (f.q ?? "").replace(/[,()%*\\]/g, " ").trim().slice(0, 80);
  if (term) {
    const digits = term.replace(/\D/g, "");
    const handle = term.replace(/^@/, "").toLowerCase();
    const ors = [`business_name.ilike.%${term}%`, `instagram_handle.ilike.%${handle}%`, `responsible_name.ilike.%${term}%`];
    if (digits.length >= 4) ors.push(`phone_e164.ilike.%${digits}%`, `phone_raw.ilike.%${term}%`);
    q = q.or(ors.join(","));
  }
  if (f.cidade) q = q.eq("city", f.cidade.slice(0, 120));
  if (f.etapa && (STAGES as readonly string[]).includes(f.etapa)) q = q.eq("stage", f.etapa);
  if (f.prioridade && (PRIORITIES as readonly string[]).includes(f.prioridade)) q = q.eq("priority", f.prioridade);
  if (f.origem && (ORIGINS as readonly string[]).includes(f.origem)) q = q.eq("origin", f.origem);
  if (f.site && (SITE_STATUSES as readonly string[]).includes(f.site)) q = q.eq("site_status", f.site);
  if (f.nao_contatados === "1") q = q.eq("contacted", false);
  if (f.oferta && OFFERS.includes(f.oferta)) q = q.eq("recommended_offer", f.oferta);
  // Datas de cadastro interpretadas no fuso de São Paulo (UTC-3).
  if (isDate(f.de)) q = q.gte("created_at", `${f.de}T00:00:00-03:00`);
  if (isDate(f.ate)) q = q.lte("created_at", `${f.ate}T23:59:59.999-03:00`);

  if (f.ordem === "prioridade") q = q.order("priority", { ascending: true }).order("created_at", { ascending: false });
  else if (f.ordem === "potencial") q = q.order("fit_score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  else if (f.ordem === "retorno") q = q.order("next_follow_up_at", { ascending: true, nullsFirst: false });
  else q = q.order("created_at", { ascending: false });
  return q as Q;
}

export const LEAD_LIST_COLUMNS =
  "id, business_name, responsible_name, city, state, neighborhood, unit_label, phone_raw, phone_e164, instagram_handle, whatsapp_url, website_url, site_status, priority, origin, stage, contacted, contact_date_unknown, last_contact_at, next_follow_up_at, created_at, fit_score, recommended_offer";

export async function listCities(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase.from("leads").select("city").limit(5000);
  return [...new Set((data ?? []).map((r: { city: string }) => r.city))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function whatsappLink(lead: { whatsapp_url: string | null; phone_e164: string | null }): string | null {
  if (lead.whatsapp_url && /^https?:\/\//i.test(lead.whatsapp_url)) return lead.whatsapp_url;
  if (lead.phone_e164) return `https://wa.me/${lead.phone_e164.replace(/\D/g, "")}`;
  return null;
}

export function safeExternal(url: string | null): string | null {
  if (!url) return null;
  const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const u = new URL(withProto);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
