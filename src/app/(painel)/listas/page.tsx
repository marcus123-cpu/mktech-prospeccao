import Link from "next/link";
import { CheckAll } from "@/components/CheckAll";
import { Empty, ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { UFS } from "@/lib/research";
import { fmtDateTime } from "@/lib/time";
import { addAllFiltered, addSelected, createList, deleteList, moveSelected, removeSelected, renameList } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listas de prospecção" };
const PAGE = 50;

type Sp = { lista?: string; q?: string; niche?: string; city?: string; state?: string; min_score?: string; max_score?: string; pagina?: string; ok?: string; erro?: string };
type Row = { id: string; business_name: string; city: string; state: string | null; niche: string | null; fit_score: number | null; contacted: boolean; last_contact_at: string | null; contact_count: number; do_not_contact: boolean };
const COLS = "id,business_name,city,state,niche,fit_score,contacted,last_contact_at,contact_count,do_not_contact";
const clean = (s?: string) => (s ?? "").replace(/[%,()*]/g, " ").trim();

export default async function ListasPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const lists = await supabase.from("lead_lists").select("id,name,created_at,lead_list_items(count)").order("name");
  if (lists.error) return <><PageHeader title="Listas de prospecção" /><ErrorBox message="Não foi possível carregar as listas. Aplique a migração 20261014180000_listas_kanban_dashboard.sql." /></>;
  const all = (lists.data ?? []).map((l) => ({ id: l.id, name: l.name, count: (l.lead_list_items as unknown as { count: number }[])?.[0]?.count ?? 0 }));
  const current = all.find((l) => l.id === sp.lista);
  const page = Math.max(1, Number.parseInt(sp.pagina ?? "1", 10) || 1);

  // Sem lista aberta: resultados filtrados de todos os leads. Com lista: só os leads dela (filtros valem também).
  let ids: string[] | null = null;
  if (current) {
    const items = await supabase.from("lead_list_items").select("lead_id").eq("list_id", current.id).limit(10000);
    ids = (items.data ?? []).map((i) => i.lead_id);
  }
  let query = supabase.from("leads").select(COLS, { count: "exact" }).order("fit_score", { ascending: false, nullsFirst: false }).order("id").range((page - 1) * PAGE, page * PAGE - 1);
  if (ids) query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const q = clean(sp.q); if (q) query = query.or(`business_name.ilike.%${q}%,city.ilike.%${q}%`);
  const niche = clean(sp.niche); if (niche) query = query.ilike("niche", `%${niche}%`);
  const city = clean(sp.city); if (city) query = query.ilike("city", `%${city}%`);
  if (sp.state && /^[A-Za-z]{2}$/.test(sp.state)) query = query.eq("state", sp.state.toUpperCase());
  if (sp.min_score && /^\d+$/.test(sp.min_score)) query = query.gte("fit_score", Number(sp.min_score));
  if (sp.max_score && /^\d+$/.test(sp.max_score)) query = query.lte("fit_score", Number(sp.max_score));
  const rows = await query;
  const leads = (rows.data ?? []) as Row[];
  const total = rows.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const hidden = (
    <>
      <input type="hidden" name="f_lista" value={current?.id ?? ""} />
      {(["q", "niche", "city", "state", "min_score", "max_score"] as const).map((k) => <input key={k} type="hidden" name={`f_${k}`} value={sp[k] ?? ""} />)}
    </>
  );
  const listOptions = all.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>);
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const k of ["lista", "q", "niche", "city", "state", "min_score", "max_score"] as const) if (sp[k]) p.set(k, sp[k]!);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/listas?${p.toString()}`;
  };

  return <>
    <PageHeader title="📋 Listas de prospecção" subtitle="Monte suas listas, filtre os leads e selecione todos os resultados. A nota é só informativa: nunca impede incluir um lead." />
    {sp.ok && <p className="mb-3 rounded border border-emerald-500/40 p-2 text-sm text-emerald-300">{sp.ok}</p>}
    {sp.erro && <p role="alert" className="mb-3 rounded border border-rose-500/40 p-2 text-sm text-rose-300">{sp.erro}</p>}

    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="card h-fit p-4">
        <h2 className="mb-2 font-semibold">Listas</h2>
        <ul className="mb-3 space-y-1 text-sm">
          <li><Link href={qs({ lista: "" }).replace(/lista=&?/, "")} className={!current ? "font-semibold underline" : ""}>Todos os leads</Link></li>
          {all.map((l) => <li key={l.id}><Link href={qs({ lista: l.id })} className={l.id === current?.id ? "font-semibold underline" : ""}>{l.name}</Link> <span className="text-muted">({l.count})</span></li>)}
        </ul>
        <form action={createList} className="flex gap-2">
          {hidden}<input name="name" required maxLength={80} placeholder="Nova lista" className="input min-w-0 flex-1" /><button className="btn-primary">Criar</button>
        </form>
        {current && <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
          <form action={renameList} className="flex gap-2">{hidden}<input type="hidden" name="list_id" value={current.id} /><input name="name" required maxLength={80} defaultValue={current.name} className="input min-w-0 flex-1" /><button className="btn-ghost">Renomear</button></form>
          <form action={deleteList}>{hidden}<input type="hidden" name="list_id" value={current.id} /><button className="btn-danger">Excluir lista</button></form>
        </div>}
      </aside>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">{current ? `Leads da lista “${current.name}”` : "Leads"} · {total} resultado(s)</h2>
        <form method="get" className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {current && <input type="hidden" name="lista" value={current.id} />}
          <input name="q" defaultValue={sp.q} placeholder="Nome ou cidade" className="input" />
          <input name="niche" defaultValue={sp.niche} placeholder="Nicho" className="input" />
          <input name="city" defaultValue={sp.city} placeholder="Cidade" className="input" />
          <select name="state" defaultValue={sp.state ?? ""} className="input"><option value="">Estado</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
          <input name="min_score" type="number" min={0} max={100} defaultValue={sp.min_score} placeholder="Nota mín." className="input" />
          <input name="max_score" type="number" min={0} max={100} defaultValue={sp.max_score} placeholder="Nota máx." className="input" />
          <button className="btn-ghost sm:col-span-3 lg:col-span-6">Filtrar</button>
        </form>

        {leads.length === 0 ? <Empty title="Nenhum lead encontrado">Ajuste os filtros ou rode uma nova pesquisa.</Empty> : <form className="space-y-3">
          {hidden}
          {current && <input type="hidden" name="list_id" value={current.id} />}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select name="target_list" className="input" defaultValue=""><option value="" disabled>Lista de destino…</option>{listOptions}</select>
            <button formAction={addSelected} className="btn-primary">Adicionar selecionados</button>
            <button formAction={addAllFiltered} className="btn-ghost" title="Adiciona todos os leads que batem com os filtros, em todas as páginas">Adicionar todos os {total} filtrados</button>
            {current && <>
              <button formAction={moveSelected} className="btn-ghost">Mover selecionados</button>
              <button formAction={removeSelected} className="btn-danger">Remover da lista</button>
            </>}
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="table-head"><th className="w-8"><CheckAll name="lead_ids" /></th><th>Lead</th><th>Cidade</th><th>Nicho</th><th>Nota</th><th>Contato</th></tr></thead>
            <tbody>{leads.map((l) => <tr key={l.id} className="border-t border-white/10">
              <td><input type="checkbox" name="lead_ids" value={l.id} /></td>
              <td><Link href={`/leads/${l.id}`} className="underline">{l.business_name}</Link>{l.do_not_contact && <span className="ml-1 text-xs text-rose-300">não contatar</span>}</td>
              <td>{l.city}{l.state ? `/${l.state}` : ""}</td><td>{l.niche ?? "—"}</td><td>{l.fit_score ?? "—"}</td>
              <td className="text-xs text-muted">{l.contacted ? `${l.contact_count || 1} contato(s) · último ${fmtDateTime(l.last_contact_at)}` : "nunca contatado"}</td>
            </tr>)}</tbody>
          </table></div>
          <nav className="flex items-center justify-between text-sm">
            {page > 1 ? <Link href={qs({ pagina: String(page - 1) })} className="underline">← Anterior</Link> : <span />}
            <span className="text-muted">Página {page} de {pages}</span>
            {page < pages ? <Link href={qs({ pagina: String(page + 1) })} className="underline">Próxima →</Link> : <span />}
          </nav>
        </form>}
      </section>
    </div>
  </>;
}
