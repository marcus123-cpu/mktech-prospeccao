import { LiveSearch } from "@/components/leads/LiveSearch";
import { LEAD_COLORS } from "@/lib/lead-colors";
import Link from "next/link";
import { LeadsList } from "./LeadsList";
import { ActionForm } from "@/components/ActionForm";
import { deleteNiche, deletePendingLeads } from "./actions";
import { requireAdmin } from "@/lib/auth";
import { ErrorBox } from "@/components/ui";
import type { LeadFilters } from "@/lib/leads-query";
type Niche = { niche: string; grupo_total: number; contatados_total: number; novos_total: number; celular: number; instagram_only: number; landline: number; no_phone: number; sem_resposta: number; responderam: number };
export const metadata = { title: "Leads" };
export default async function LeadsPage({ searchParams }: { searchParams: Promise<LeadFilters & { aba?: string; excluido?: string; busca?: string; grupo?: string }> }) {
  const sp = await searchParams;
  const list = sp.aba === "todos" || Object.keys(sp).some(key => !["aba", "excluido", "busca", "grupo"].includes(key));
  const tabs = <nav aria-label="Abas de leads" className="mb-5 flex gap-2"><Link className={list ? "btn-ghost" : "btn-primary"} href="/leads">Visão geral</Link><Link className={list ? "btn-primary" : "btn-ghost"} href="/leads?aba=todos">Todos os leads</Link></nav>;
  if (list) return <>{tabs}<LeadsList searchParams={searchParams} /></>;
  const { supabase } = await requireAdmin();
  const contatados = sp.grupo === "contatados";
  const grupo = contatados ? "contatados" : "novos";
  const [{ data, error }, outro] = await Promise.all([
    supabase.rpc("admin_lead_dashboard_grupo", { p_contacted: contatados }),
    supabase.rpc("admin_lead_dashboard_grupo", { p_contacted: !contatados }),
  ]);
  if (error) return <>{tabs}<ErrorBox message="Não foi possível carregar os indicadores de leads." /></>;
  const all = (data ?? []) as Niche[];
  const nichosDoOutro = ((outro.data ?? []) as Niche[]).length;
  const pendentes = await supabase.from("leads").select("id", { count: "exact", head: true }).eq("origin", "hermes").eq("site_status", "verificacao_pendente");
  // Vários nichos na mesma busca: "massagem, massoterapia ou massoterapeuta".
  const terms = (sp.busca ?? "").split(/,|;|\/|\bou\b/i).map(t => t.trim().toLowerCase()).filter(Boolean);
  const niches = terms.length ? all.filter(n => terms.some(t => n.niche.toLowerCase().includes(t))) : all;
  const dispatchUrl = (term: string) => `/disparo?${new URLSearchParams({ niche: term })}`;
  const sum = (key: keyof Omit<Niche, "niche">) => niches.reduce((s, n) => s + Number(n[key]), 0);
  // Os links já levam só quem está neste grupo (não contatados ou contatados).
  const url = (extra: Record<string, string>, niche?: string) => `/leads?${new URLSearchParams({ aba: "todos", ...(contatados ? { categoria: "contatados" } : { nao_contatados: "1" }), ...extra, ...(niche ? { nicho: niche } : {}) })}`;
  const grupoLink = (g: string, busca?: string) => `/leads?${new URLSearchParams({ grupo: g, ...(busca ? { busca } : {}) })}`;
  const grupoTabs = <nav aria-label="Grupo de nichos" className="mb-5 flex flex-wrap gap-2">
    <Link href={grupoLink("novos", sp.busca)} aria-current={!contatados ? "page" : undefined} className={!contatados ? "btn-primary" : "btn-ghost"}>🆕 Nichos não contatados ({contatados ? nichosDoOutro : all.length})</Link>
    <Link href={grupoLink("contatados", sp.busca)} aria-current={contatados ? "page" : undefined} className={contatados ? "btn-primary" : "btn-ghost"}>✅ Nichos contatados ({contatados ? all.length : nichosDoOutro})</Link>
  </nav>;
  const cards: [string, number, string, string][] = contatados
    ? [["Contatados", sum("grupo_total"), url({}), "contatados"], ["Sem resposta ainda", sum("sem_resposta"), url({ etapa: "contatado" }), "instagram"], ["Já responderam", sum("responderam"), url({}), "fixo"]]
    : [["Não contatados", sum("grupo_total"), url({}), "novos"], ["Celular (WhatsApp)", sum("celular"), url({}), "todos"], ["Só Instagram", sum("instagram_only"), url({ categoria: "instagram" }), "instagram"], ["Telefone fixo", sum("landline"), url({ categoria: "fixo" }), "fixo"], ["Sem número", sum("no_phone"), url({ categoria: "sem_numero" }), "sem_numero"]];
  return <>{tabs}<header className="mb-4"><h1 className="text-2xl font-semibold">Seus leads</h1><p className="mt-1 text-sm text-muted">{contatados ? "Nichos em que você já falou com alguém. O que ainda não foi contatado aparece na outra aba." : "Só nichos que ainda têm lead para contatar. Quem já foi contatado fica na aba “Nichos contatados”."}</p></header>
    {grupoTabs}
    <form method="get" role="search" className="card mb-6 flex flex-wrap gap-2 p-3"><LiveSearch initial={sp.busca ?? ""} grupo={contatados ? "contatados" : ""} />{terms.length > 0 && <Link href={grupoLink(grupo)} className="btn-ghost">Limpar</Link>}</form>
    {terms.length > 0 && <section className="card mb-6 flex flex-wrap items-center justify-between gap-3 border-accent/40 p-4"><p className="text-sm">{niches.length === 0 ? "Nenhum nicho encontrado para esta busca." : <><b>{niches.length}</b> nicho(s) encontrado(s) · <b>{sum("grupo_total")}</b> lead(s) {contatados ? "contatado(s)" : "não contatado(s)"}</>}</p>{niches.length > 0 && !contatados && <Link className="btn-primary" href={dispatchUrl(terms.join(","))}>🚀 Fazer disparo para todos desta busca</Link>}</section>}
    <div className={`mb-6 grid gap-3 sm:grid-cols-3 ${contatados ? "" : "lg:grid-cols-5"}`}>{cards.map(([label, value, href, color]) => <Link key={label} href={href} className={`card p-4 transition hover:brightness-125 ${LEAD_COLORS[color as keyof typeof LEAD_COLORS] ?? LEAD_COLORS.todos}`}><span className="text-xs text-muted">{label}</span><strong className="mt-2 block text-3xl tabular-nums">{value}</strong></Link>)}</div>
    {!contatados && (pendentes.count ?? 0) > 0 && <section className="card mb-6 flex flex-wrap items-center justify-between gap-3 border-amber-500/40 p-4"><p className="text-sm"><b>{pendentes.count}</b> lead(s) vieram da pesquisa <b>sem confirmar se têm site</b>. A pesquisa nova só cadastra quem teve “sem site” confirmado. Quem já teve conversa ou mensagem é mantido.</p><ActionForm action={deletePendingLeads} submit="🗑 Excluir os sem verificação" variant="btn-danger" className="space-y-0" confirmText="Excluir todos os leads que vieram sem verificação de site e nunca foram contatados? Não dá para desfazer." /></section>}
    <h2 className="mb-3 text-lg font-semibold">{contatados ? "Nichos contatados" : "Nichos com lead para contatar"}</h2>
    {niches.length === 0 && <p className="card p-6 text-sm text-muted">{contatados ? "Nenhum nicho contatado ainda." : "Nenhum nicho com lead para contatar. Peça uma nova pesquisa ao Hermes."}</p>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{niches.map(n => <section key={n.niche} className="card p-5">
      <Link href={url({}, n.niche)} className="text-base font-semibold text-accent">{n.niche} <span className="float-right text-text">{n.grupo_total}</span></Link>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">{(contatados
        ? [["Sem resposta", n.sem_resposta, url({ etapa: "contatado" }, n.niche), "instagram"], ["Já responderam", n.responderam, url({}, n.niche), "fixo"]]
        : [["Celular (WhatsApp)", n.celular, url({}, n.niche), "todos"], ["Só Instagram", n.instagram_only, url({ categoria: "instagram" }, n.niche), "instagram"], ["Fixo", n.landline, url({ categoria: "fixo" }, n.niche), "fixo"], ["Sem número", n.no_phone, url({ categoria: "sem_numero" }, n.niche), "sem_numero"]]
      ).map(([label, count, href, color]) => <Link className={`rounded-lg border p-2 transition hover:brightness-125 ${LEAD_COLORS[color as keyof typeof LEAD_COLORS]}`} key={String(label)} href={String(href)}>{label}<b className="float-right">{count}</b></Link>)}</div>
      {!contatados && <Link href={dispatchUrl(n.niche)} className="btn-primary mt-4 w-full">🚀 Fazer disparo para {n.niche}</Link>}
      {contatados && n.novos_total > 0 && <Link href={grupoLink("novos", n.niche)} className="btn-ghost mt-4 w-full">Este nicho ainda tem {n.novos_total} para contatar →</Link>}
      <details className="mt-3"><summary className="cursor-pointer text-xs text-muted hover:text-rose-300">🗑 Excluir este nicho</summary><div className="mt-2 space-y-2 rounded-lg border border-rose-900/50 p-3">
        {!contatados && <ActionForm action={deleteNiche} submit={`Excluir os ${n.novos_total} não contatados`} variant="btn-danger" className="space-y-0" confirmText={`Excluir os leads não contatados do nicho “${n.niche}”? Quem já tem conversa continua. Não dá para desfazer.`}><input type="hidden" name="niche" value={n.niche} /></ActionForm>}
        <ActionForm action={deleteNiche} submit={`Excluir TUDO do nicho (${n.novos_total + n.contatados_total})`} variant="btn-danger" className="space-y-0" confirmText={`ATENÇÃO: apagar TODOS os ${n.novos_total + n.contatados_total} leads do nicho “${n.niche}”, inclusive ${n.contatados_total} contatados e as conversas deles. Não dá para desfazer. Continuar?`}><input type="hidden" name="niche" value={n.niche} /><input type="hidden" name="tudo" value="1" /></ActionForm>
      </div></details></section>)}</div></>;
}
