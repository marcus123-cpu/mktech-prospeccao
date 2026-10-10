import Link from "next/link";
import { FiltersToggle } from "@/components/leads/FiltersToggle";
import { LeadsTable, type LeadRow } from "@/components/leads/LeadsTable";
import { Empty, ErrorBox, PageHeader } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { OFFER_LABEL, OFFERS, ORIGIN_LABEL, ORIGINS, PRIORITIES, PRIORITY_LABEL, SITE_LABEL, SITE_STATUSES, STAGE_LABEL, STAGES } from "@/lib/labels";
import { LEAD_LIST_COLUMNS, PAGE_SIZE, applyLeadFilters, listCities, type LeadFilters } from "@/lib/leads-query";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<LeadFilters & { excluido?: string }> }) {
  const f = await searchParams;
  const { supabase } = await requireAdmin();
  const page = Math.max(1, Number.parseInt(f.pagina ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const query = applyLeadFilters(
    supabase.from("leads").select(LEAD_LIST_COLUMNS, { count: "exact" }),
    f,
  ).range(from, from + PAGE_SIZE - 1);
  const [{ data, count, error }, cities, { count: pendingReviews }] = await Promise.all([
    query,
    listCities(supabase),
    supabase.from("duplicate_reviews").select("id", { count: "exact", head: true }).eq("status", "pendente"),
  ]);

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const params = new URLSearchParams(
    Object.entries(f).filter(([k, v]) => typeof v === "string" && v && k !== "pagina" && k !== "excluido") as [string, string][],
  );
  const pageHref = (p: number) => `/leads?${new URLSearchParams([...params, ["pagina", String(p)]])}`;
  const hasFilters = [...params.keys()].some((k) => k !== "ordem");

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={`${total} ${total === 1 ? "lead encontrado" : "leads encontrados"}`}
        actions={
          <>
            <Link href="/leads/duplicados" className="btn-ghost">
              Possíveis duplicados{pendingReviews ? ` (${pendingReviews})` : ""}
            </Link>
            <Link href="/leads/importar" className="btn-ghost">Importar</Link>
            <a href={`/api/leads/export?${params}`} className="btn-ghost">Exportar CSV</a>
            <Link href="/leads/novo" className="btn-primary order-first sm:order-none">Novo lead</Link>
          </>
        }
      />
      {f.excluido && <p className="mb-4 text-sm text-emerald-300">Lead excluído.</p>}

      <FiltersToggle active={[...params.keys()].filter((k) => k !== "ordem").length}>
      <form className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6" action="/leads">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="q">Buscar</label>
          <input className="input" id="q" name="q" placeholder="Nome, telefone ou @instagram" defaultValue={f.q} />
        </div>
        <div>
          <label className="label" htmlFor="cidade">Cidade</label>
          <select className="input" id="cidade" name="cidade" defaultValue={f.cidade ?? ""}>
            <option value="">Todas</option>
            {cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="etapa">Etapa</label>
          <select className="input" id="etapa" name="etapa" defaultValue={f.etapa ?? ""}>
            <option value="">Todas</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="prioridade">Prioridade</label>
          <select className="input" id="prioridade" name="prioridade" defaultValue={f.prioridade ?? ""}>
            <option value="">Todas</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="origem">Origem</label>
          <select className="input" id="origem" name="origem" defaultValue={f.origem ?? ""}>
            <option value="">Todas</option>
            {ORIGINS.map((o) => (
              <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="oferta">Oferta sugerida</label>
          <select className="input" id="oferta" name="oferta" defaultValue={f.oferta ?? ""}>
            <option value="">Todas</option>
            {OFFERS.map((o) => (
              <option key={o} value={o}>{OFFER_LABEL[o]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="site">Verificação de site</label>
          <select className="input" id="site" name="site" defaultValue={f.site ?? ""}>
            <option value="">Todas</option>
            {SITE_STATUSES.map((s) => (
              <option key={s} value={s}>{SITE_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:contents">
        <div>
          <label className="label" htmlFor="de">Cadastro de</label>
          <input className="input" type="date" id="de" name="de" defaultValue={f.de} />
        </div>
        <div>
          <label className="label" htmlFor="ate">até</label>
          <input className="input" type="date" id="ate" name="ate" defaultValue={f.ate} />
        </div>
        </div>
        <div>
          <label className="label" htmlFor="ordem">Ordenar por</label>
          <select className="input" id="ordem" name="ordem" defaultValue={f.ordem ?? "cadastro"}>
            <option value="cadastro">Cadastro mais recente</option>
            <option value="potencial">Maior potencial</option>
            <option value="prioridade">Prioridade</option>
            <option value="retorno">Próximo retorno</option>
          </select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="nao_contatados" value="1" defaultChecked={f.nao_contatados === "1"} />
          Ainda não contatados
        </label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4 xl:col-span-6">
          <button className="btn-primary flex-1 sm:flex-none">Filtrar</button>
          {hasFilters && <Link href="/leads" className="btn-ghost flex-1 sm:flex-none">Limpar filtros</Link>}
        </div>
      </form>
      </FiltersToggle>

      {error ? (
        <ErrorBox message={dbErrorMessage(error)} />
      ) : !data || data.length === 0 ? (
        <Empty title={hasFilters ? "Nenhum lead com esses filtros." : "Nenhum lead cadastrado ainda."}>
          {!hasFilters && (
            <>
              Importe sua planilha em <Link href="/leads/importar" className="text-accent">Importar</Link> ou cadastre um
              lead manualmente.
            </>
          )}
        </Empty>
      ) : (
        <>
          <LeadsTable rows={data as unknown as LeadRow[]} />
          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginação">
              {page > 1 ? <Link className="btn-ghost" href={pageHref(page - 1)}>Anterior</Link> : <span />}
              <span className="text-muted">Página {page} de {pages}</span>
              {page < pages ? <Link className="btn-ghost" href={pageHref(page + 1)}>Próxima</Link> : <span />}
            </nav>
          )}
        </>
      )}
    </>
  );
}
