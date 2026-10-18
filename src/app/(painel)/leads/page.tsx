import { LEAD_COLORS } from "@/lib/lead-colors";
import Link from "next/link";
import { LeadsList } from "./LeadsList";
import { requireAdmin } from "@/lib/auth";
import { ErrorBox } from "@/components/ui";
import type { LeadFilters } from "@/lib/leads-query";
type Niche = { niche: string; total: number; contacted: number; uncontacted: number; instagram_only: number; landline: number; no_phone: number };
export const metadata = { title: "Leads" };
export default async function LeadsPage({ searchParams }: { searchParams: Promise<LeadFilters & { aba?: string; excluido?: string }> }) {
  const sp = await searchParams;
  const list = sp.aba === "todos" || Object.keys(sp).some(key => !["aba", "excluido"].includes(key));
  const tabs = <nav aria-label="Abas de leads" className="mb-5 flex gap-2"><Link className={list ? "btn-ghost" : "btn-primary"} href="/leads">Visão geral</Link><Link className={list ? "btn-primary" : "btn-ghost"} href="/leads?aba=todos">Todos os leads</Link></nav>;
  if (list) return <>{tabs}<LeadsList searchParams={searchParams} /></>;
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("admin_lead_dashboard");
  if (error) return <>{tabs}<ErrorBox message="Não foi possível carregar os indicadores de leads." /></>;
  const niches = (data ?? []) as Niche[];
  const total = (key: keyof Omit<Niche, "niche">) => niches.reduce((sum, n) => sum + Number(n[key]), 0);
  const url = (category: string, niche?: string) => `/leads?${new URLSearchParams({ aba: "todos", categoria: category, ...(niche ? { nicho: niche } : {}) })}`;
  return <>{tabs}<header className="mb-6"><h1 className="text-2xl font-semibold">Seus leads</h1><p className="mt-1 text-sm text-muted">Contatos organizados por nicho e canal disponível.</p></header>
    <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{([
      ["total", "Todos", ""], ["contacted", "Contatados", "contatados"], ["uncontacted", "Não contatados", "novos"],
      ["instagram_only", "Só Instagram", "instagram"], ["landline", "Telefone fixo", "fixo"], ["no_phone", "Sem número", "sem_numero"],
    ] as const).map(([key, label, category]) => <Link key={key} href={url(category)} className={`card p-4 transition hover:brightness-125 ${LEAD_COLORS[category as keyof typeof LEAD_COLORS] ?? LEAD_COLORS.todos}`}><span className="text-xs text-muted">{label}</span><strong className="mt-2 block text-3xl tabular-nums">{total(key)}</strong></Link>)}</div>
    <h2 className="mb-3 text-lg font-semibold">Por nicho</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{niches.map(n => <section key={n.niche} className="card p-5"><Link href={url("", n.niche)} className="text-base font-semibold text-accent">{n.niche} <span className="float-right text-text">{n.total}</span></Link><div className="mt-4 grid grid-cols-2 gap-2 text-sm">{([["contatados", "Contatados", n.contacted], ["novos", "Não contatados", n.uncontacted], ["instagram", "Só Instagram", n.instagram_only], ["fixo", "Fixo", n.landline], ["sem_numero", "Sem número", n.no_phone]] as const).map(([category, label, count]) => <Link className={`rounded-lg border p-2 transition hover:brightness-125 ${LEAD_COLORS[category as keyof typeof LEAD_COLORS]}`} key={category} href={url(category, n.niche)}>{label}<b className="float-right">{count}</b></Link>)}</div></section>)}</div></>;
}
