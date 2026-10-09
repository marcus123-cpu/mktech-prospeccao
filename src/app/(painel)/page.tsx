import Link from "next/link";
import { DailyChart } from "@/components/dashboard/DailyChart";
import { PeriodFilter } from "@/components/PeriodFilter";
import { ErrorBox, PageHeader, Stat } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { RUN_STATUS_LABEL, STAGE_LABEL, STAGES } from "@/lib/labels";
import { fmtDate, fmtDateTime, fmtMoney, fmtPercent, periodRange, type PeriodKey } from "@/lib/time";

export const metadata = { title: "Dashboard" };

type Metrics = {
  total_leads: number;
  new_leads: number;
  contact_actions: number;
  contacted_leads: number;
  first_contacts: number;
  contacted_total: number;
  contacted_undated: number;
  responded: number;
  interested: number;
  proposals_sent: number;
  closed_sales: number;
  closed_value: number;
  disqualified: number;
  follow_ups_overdue: number;
  follow_ups_today: number;
  duplicates_blocked: number;
  pending_reviews: number;
  response_rate: number | null;
  sale_conversion: number | null;
  proposal_conversion: number | null;
  rate_basis: Record<string, number>;
  last_run: { status: string; started_at: string; finished_at: string | null; created: number; end_reason: string | null } | null;
  by_stage: Record<string, number>;
  daily: { day: string; new_leads: number; contacts: number }[];
};

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; inicio?: string; fim?: string }>;
}) {
  const sp = await searchParams;
  const key = (["hoje", "semana", "mes", "personalizado"].includes(sp.periodo ?? "") ? sp.periodo : "semana") as PeriodKey;
  const { start, end } = periodRange(key, new Date(), { start: sp.inicio, end: sp.fim });
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("dashboard_metrics", { p_start: start, p_end: end });
  const m = data as Metrics | null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Período: ${fmtDate(`${start}T12:00:00Z`)} a ${fmtDate(`${end}T12:00:00Z`)} (horário de São Paulo)`}
      />
      <div className="mb-6">
        <PeriodFilter current={key} start={start} end={end} />
      </div>
      {error || !m ? (
        <ErrorBox message={dbErrorMessage(error) || "Não foi possível calcular os indicadores."} />
      ) : (
        <div className="space-y-6">
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Total de leads" value={m.total_leads} />
            <Stat label="Novos no período" value={m.new_leads} />
            <Stat
              label="Leads contatados"
              value={m.contacted_leads}
              hint={`${m.contact_actions} ações de contato no período`}
            />
            <Stat label="Responderam" value={m.responded} hint="mudaram para Respondeu no período" />
            <Stat label="Interessados" value={m.interested} />
            <Stat label="Propostas enviadas" value={m.proposals_sent} />
            <Stat label="Vendas fechadas" value={m.closed_sales} />
            <Stat label="Valor fechado" value={fmtMoney(m.closed_value)} />
            <Stat label="Desqualificados" value={m.disqualified} />
            <Stat
              label="Retornos"
              value={
                <Link href="/retornos" className="hover:text-accent">
                  <span className={m.follow_ups_overdue ? "text-rose-300" : ""}>{m.follow_ups_overdue}</span>
                  <span className="text-base text-muted"> vencidos · </span>
                  {m.follow_ups_today}
                  <span className="text-base text-muted"> hoje</span>
                </Link>
              }
            />
            <Stat label="Duplicados bloqueados" value={m.duplicates_blocked} hint={`${m.pending_reviews} aguardando revisão`} />
            <Stat
              label="Última execução do Hermes"
              value={m.last_run ? RUN_STATUS_LABEL[m.last_run.status] ?? m.last_run.status : "—"}
              hint={m.last_run ? `${fmtDateTime(m.last_run.started_at)} · ${m.last_run.created} criados` : "nenhuma execução registrada"}
            />
          </section>

          <section className="grid gap-3 md:grid-cols-3">
            <Stat
              label="Taxa de resposta"
              value={fmtPercent(m.response_rate)}
              hint={`${m.rate_basis.cohort_responded} de ${m.rate_basis.cohort} leads com 1º contato no período`}
            />
            <Stat
              label="Conversão em venda"
              value={fmtPercent(m.sale_conversion)}
              hint={`${m.rate_basis.cohort_closed} de ${m.rate_basis.cohort} leads com 1º contato no período`}
            />
            <Stat
              label="Conversão de propostas"
              value={fmtPercent(m.proposal_conversion)}
              hint={`${m.rate_basis.proposal_closed} de ${m.rate_basis.proposal_cohort} leads com 1ª proposta no período`}
            />
          </section>

          <section className="grid gap-3 lg:grid-cols-3">
            <div className="card p-4 lg:col-span-2">
              <h2 className="mb-3 text-sm font-semibold">Novos leads e contatos por dia</h2>
              <DailyChart data={m.daily} />
            </div>
            <div className="card p-4">
              <h2 className="mb-3 text-sm font-semibold">Leads por etapa (hoje)</h2>
              <ul className="space-y-2 text-sm">
                {STAGES.map((s) => (
                  <li key={s} className="flex justify-between">
                    <Link href={`/leads?etapa=${s}`} className="text-muted hover:text-slate-200">{STAGE_LABEL[s]}</Link>
                    <span className="tabular-nums">{m.by_stage[s] ?? 0}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                {m.contacted_total} leads já contatados no total, {m.contacted_undated} deles importados sem data de contato
                (não entram em nenhum período).
              </p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
