import { LiveSearch } from "@/components/leads/LiveSearch";
import { LEAD_COLORS } from "@/lib/lead-colors";
import Link from "next/link";
import { LeadsList } from "./LeadsList";
import { ActionForm } from "@/components/ActionForm";
import { deleteNiche, deletePendingLeads } from "./actions";
import { requireAdmin } from "@/lib/auth";
import { ErrorBox } from "@/components/ui";
import type { LeadFilters } from "@/lib/leads-query";
type Niche = { niche: string; total: number; contacted: number; uncontacted: number; instagram_only: number; landline: number; no_phone: number };
export const metadata = { title: "Leads" };
export default async function LeadsPage({ searchParams }: { searchParams: Promise<LeadFilters & { aba?: string; excluido?: string; busca?: string }> }) {
  const sp = await searchParams;
  const list = sp.aba === "todos" || Object.keys(sp).some(key => !["aba", "excluido", "busca"].includes(key));
  const tabs = <nav aria-label="Abas de leads" className="mb-5 flex gap-2"><Link className={list ? "btn-ghost" : "btn-primary"} href="/leads">Visão geral</Link><Link className={list ? "btn-primary" : "btn-ghost"} href="/leads?aba=todos">Todos os leads</Link></nav>;
  if (list) return <>{tabs}<LeadsList searchParams={searchParams} /></>;
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("admin_lead_dashboard");
  if (error) return <>{tabs}<ErrorBox message="Não foi possível carregar os indicadores de leads." /></>;
  const all = (data ?? []) as Niche[];
  const pendentes = await supabase.from("leads").select("id", { count: "exact", head: true }).eq("origin", "hermes").eq("site_status", "verificacao_pendente");
  // Vários nichos na mesma busca: "massagem, massoterapia ou massoterapeuta".
  const terms = (sp.busca ?? "").split(/,|;|\/|\bou\b/i).map(t => t.trim().toLowerCase()).filter(Boolean);
  const niches = terms.length ? all.filter(n => terms.some(t => n.niche.toLowerCase().includes(t))) : all;
  const dispatchUrl = (term: string) => `/disparo?${new URLSearchParams({ niche: term })}`;
  const total = (key: keyof Omit<Niche, "niche">) => niches.reduce((sum, n) => sum + Number(n[key]), 0);
  const url = (category: string, niche?: string) => `/leads?${new URLSearchParams({ aba: "todos", categoria: category, ...(niche ? { nicho: niche } : {}) })}`;
  return <>{tabs}<header className="mb-6"><h1 className="text-2xl font-semibold">Seus leads</h1><p className="mt-1 text-sm text-muted">Contatos organizados por nicho e canal disponível.</p></header>
    <form method="get" role="search" className="card mb-6 flex flex-wrap gap-2 p-3"><LiveSearch initial={sp.busca ?? ""} />{terms.length > 0 && <Link href="/leads" className="btn-ghost">Limpar</Link>}</form>
    {terms.length > 0 && <section className="card mb-6 flex flex-wrap items-center justify-between gap-3 border-accent/40 p-4"><p className="text-sm">{niches.length === 0 ? "Nenhum nicho encontrado para esta busca." : <><b>{niches.length}</b> nicho(s) encontrado(s) · <b>{niches.reduce((s, n) => s + Number(n.uncontacted), 0)}</b> lead(s) não contatado(s)</>}</p>{niches.length > 0 && <Link className="btn-primary" href={dispatchUrl(terms.join(","))}>🚀 Fazer disparo para todos desta busca</Link>}</section>}
    <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{([
      ["total", "Todos", ""], ["contacted", "Contatados", "contatados"], ["uncontacted", "Não contatados", "novos"],
      ["instagram_only", "Só Instagram", "instagram"], ["landline", "Telefone fixo", "fixo"], ["no_phone", "Sem número", "sem_numero"],
    ] as const).map(([key, label, category]) => <Link key={key} href={url(category)} className={`card p-4 transition hover:brightness-125 ${LEAD_COLORS[category as keyof typeof LEAD_COLORS] ?? LEAD_COLORS.todos}`}><span className="text-xs text-muted">{label}</span><strong className="mt-2 block text-3xl tabular-nums">{total(key)}</strong></Link>)}</div>
    {(pendentes.count ?? 0) > 0 && <section className="card mb-6 flex flex-wrap items-center justify-between gap-3 border-amber-500/40 p-4"><p className="text-sm"><b>{pendentes.count}</b> lead(s) vieram da pesquisa <b>sem confirmar se têm site</b>. A pesquisa nova só cadastra quem teve “sem site” confirmado. Quem já teve conversa ou mensagem é mantido.</p><ActionForm action={deletePendingLeads} submit="🗑 Excluir os sem verificação" variant="btn-danger" className="space-y-0" confirmText="Excluir todos os leads que vieram sem verificação de site e nunca foram contatados? Não dá para desfazer." /></section>}
    <h2 className="mb-3 text-lg font-semibold">Por nicho</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{niches.map(n => <section key={n.niche} className="card p-5"><Link href={url("", n.niche)} className="text-base font-semibold text-accent">{n.niche} <span className="float-right text-text">{n.total}</span></Link><div className="mt-4 grid grid-cols-2 gap-2 text-sm">{([["contatados", "Contatados", n.contacted], ["novos", "Não contatados", n.uncontacted], ["instagram", "Só Instagram", n.instagram_only], ["fixo", "Fixo", n.landline], ["sem_numero", "Sem número", n.no_phone]] as const).map(([category, label, count]) => <Link className={`rounded-lg border p-2 transition hover:brightness-125 ${LEAD_COLORS[category as keyof typeof LEAD_COLORS]}`} key={category} href={url(category, n.niche)}>{label}<b className="float-right">{count}</b></Link>)}</div><Link href={dispatchUrl(n.niche)} className="btn-primary mt-4 w-full">🚀 Fazer disparo para {n.niche}</Link>
      <details className="mt-3"><summary className="cursor-pointer text-xs text-muted hover:text-rose-300">🗑 Excluir este nicho</summary><div className="mt-2 space-y-2 rounded-lg border border-rose-900/50 p-3">
        <ActionForm action={deleteNiche} submit={`Excluir os ${n.uncontacted} não contatados`} variant="btn-danger" className="space-y-0" confirmText={`Excluir os leads não contatados do nicho “${n.niche}”? Quem já tem conversa continua. Não dá para desfazer.`}><input type="hidden" name="niche" value={n.niche} /></ActionForm>
        <ActionForm action={deleteNiche} submit={`Excluir TUDO do nicho (${n.total})`} variant="btn-danger" className="space-y-0" confirmText={`ATENÇÃO: apagar TODOS os ${n.total} leads do nicho “${n.niche}”, inclusive ${n.contacted} contatados e as conversas deles. Não dá para desfazer. Continuar?`}><input type="hidden" name="niche" value={n.niche} /><input type="hidden" name="tudo" value="1" /></ActionForm>
      </div></details></section>)}</div></>;
}
