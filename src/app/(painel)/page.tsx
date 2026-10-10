import Link from "next/link";
import { DailyChart } from "@/components/dashboard/DailyChart";
import { PeriodFilter } from "@/components/PeriodFilter";
import { ErrorBox, PageHeader, Stat } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { OFFER_LABEL, RUN_STATUS_LABEL, STAGE_LABEL, STAGES } from "@/lib/labels";
import { whatsappLink } from "@/lib/leads-query";
import { fmtDate, fmtDateTime, fmtMoney, fmtPercent, periodRange, todaySP, type PeriodKey } from "@/lib/time";

export const metadata = { title: "Hoje" };

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

type TopLead = {
  id: string;
  business_name: string;
  city: string;
  fit_score: number | null;
  recommended_offer: string | null;
  selection_reason: string | null;
  whatsapp_url: string | null;
  phone_e164: string | null;
};

const TO_APPROACH = "/leads?etapa=novo&nao_contatados=1&ordem=potencial";

export default async function Hoje({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; inicio?: string; fim?: string }>;
}) {
  const sp = await searchParams;
  const key = (["hoje", "semana", "mes", "personalizado"].includes(sp.periodo ?? "") ? sp.periodo : "semana") as PeriodKey;
  const { start, end } = periodRange(key, new Date(), { start: sp.inicio, end: sp.fim });
  const { supabase } = await requireAdmin();

  const [metrics, top, toApproach, settings] = await Promise.all([
    supabase.rpc("dashboard_metrics", { p_start: start, p_end: end }),
    supabase
      .from("leads")
      .select("id, business_name, city, fit_score, recommended_offer, selection_reason, whatsapp_url, phone_e164")
      .eq("stage", "novo")
      .eq("contacted", false)
      .order("fit_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("stage", "novo").eq("contacted", false),
    supabase.from("prospecting_settings").select("routine_enabled, daily_target").eq("id", 1).maybeSingle(),
  ]);
  const m = metrics.data as Metrics | null;
  const leads = (top.data ?? []) as TopLead[];

  // Resumo do diagnóstico mais recente de cada lead da lista.
  const summaries = new Map<string, string>();
  if (leads.length) {
    const { data: diags } = await supabase
      .from("lead_diagnoses")
      .select("lead_id, summary, created_at")
      .in("lead_id", leads.map((l) => l.id))
      .order("created_at", { ascending: false });
    for (const d of diags ?? []) if (!summaries.has(d.lead_id)) summaries.set(d.lead_id, d.summary);
  }

  const today = todaySP();

  return (
    <>
      <PageHeader title="Hoje" subtitle={`${fmtDate(`${today}T12:00:00Z`)} · o que fazer agora e como está a prospecção`} />

      {metrics.error || !m ? (
        <ErrorBox message={dbErrorMessage(metrics.error) || "Não foi possível carregar o painel."} />
      ) : (
        <div className="space-y-8">
          {/* 1. Ações do dia */}
          <section>
            <h2 className="mb-3 text-sm font-semibold">O que fazer agora</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <ActionCard
                href={TO_APPROACH}
                number={toApproach.count ?? 0}
                title="leads para abordar"
                text="Pesquisados e ainda sem contato. Comece pelos de maior potencial."
              />
              <ActionCard
                href="/retornos"
                number={m.follow_ups_overdue + m.follow_ups_today}
                title="retornos para fazer"
                text={`${m.follow_ups_overdue} atrasados e ${m.follow_ups_today} marcados para hoje.`}
                alert={m.follow_ups_overdue > 0}
              />
              <ActionCard
                href="/leads/duplicados"
                number={m.pending_reviews}
                title="possíveis duplicados"
                text="Cadastros parecidos com outros. Decida se é o mesmo negócio."
              />
            </div>
          </section>

          {/* 2. Melhores leads */}
          <section>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">Melhores leads para abordar</h2>
              <Link href={TO_APPROACH} className="text-xs text-muted hover:text-slate-200">ver todos</Link>
            </div>
            {leads.length === 0 ? (
              <div className="card p-4 text-sm text-muted">
                Nenhum lead novo esperando contato. Rode o Hermes ou importe sua planilha em Leads › Importar.
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {leads.map((l) => {
                  const wa = whatsappLink(l);
                  return (
                    <div key={l.id} className="card flex flex-col gap-2 p-4 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/leads/${l.id}`} className="break-words font-semibold hover:text-accent">{l.business_name}</Link>
                          <div className="text-xs text-muted">{l.city}</div>
                        </div>
                        <Score value={l.fit_score} />
                      </div>
                      {l.recommended_offer && (
                        <div className="text-xs">
                          Oferecer: <span className="font-medium text-accent">{OFFER_LABEL[l.recommended_offer] ?? l.recommended_offer}</span>
                        </div>
                      )}
                      <p className="line-clamp-3 text-muted">{summaries.get(l.id) ?? l.selection_reason ?? "Sem resumo."}</p>
                      <div className="mt-auto flex gap-2 pt-1">
                        <Link href={`/leads/${l.id}`} className="btn-primary flex-1 sm:flex-none">Ver diagnóstico</Link>
                        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-ghost flex-1 sm:flex-none">WhatsApp</a>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 3. Hermes */}
          <section className="card p-4 text-sm">
            <h2 className="mb-1 text-sm font-semibold">Hermes</h2>
            <p>
              Rotina diária{" "}
              {settings.data?.routine_enabled ? (
                <span className="font-medium text-emerald-300">ligada</span>
              ) : (
                <span className="font-medium text-amber-300">pausada</span>
              )}
              {settings.data && <> · meta de {settings.data.daily_target} leads por dia</>}.{" "}
              {m.last_run ? (
                <>
                  Última pesquisa em {fmtDateTime(m.last_run.started_at)}:{" "}
                  {RUN_STATUS_LABEL[m.last_run.status]?.toLowerCase() ?? m.last_run.status}, {m.last_run.created} lead(s)
                  cadastrado(s).
                </>
              ) : (
                <>Nenhuma pesquisa registrada ainda.</>
              )}
            </p>
            <Link href="/execucoes" className="mt-2 inline-block text-xs text-muted hover:text-slate-200">ver histórico de pesquisas</Link>
          </section>

          {/* 4. Resultados */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Seus resultados</h2>
                <p className="text-xs text-muted">
                  {fmtDate(`${start}T12:00:00Z`)} a {fmtDate(`${end}T12:00:00Z`)}, horário de São Paulo
                </p>
              </div>
              <PeriodFilter current={key} start={start} end={end} />
            </div>

            <Funnel
              steps={[
                { label: "Novos leads", value: m.new_leads, help: "cadastrados no período" },
                { label: "Contatados", value: m.contacted_leads, help: "você falou com eles no período" },
                { label: "Responderam", value: m.responded, help: "passaram para Respondeu" },
                { label: "Interessados", value: m.interested, help: "pediram mais informações" },
                { label: "Propostas", value: m.proposals_sent, help: "propostas enviadas" },
                { label: "Vendas", value: m.closed_sales, help: fmtMoney(m.closed_value) },
              ]}
            />

            <div className="grid gap-3 md:grid-cols-3">
              <Stat
                label="Taxa de resposta"
                value={fmtPercent(m.response_rate)}
                hint={rateHint(m.rate_basis.cohort_responded, m.rate_basis.cohort, "responderam")}
              />
              <Stat
                label="Viraram venda"
                value={fmtPercent(m.sale_conversion)}
                hint={rateHint(m.rate_basis.cohort_closed, m.rate_basis.cohort, "fecharam")}
              />
              <Stat
                label="Propostas que fecharam"
                value={fmtPercent(m.proposal_conversion)}
                hint={
                  m.rate_basis.proposal_cohort
                    ? `${m.rate_basis.proposal_closed} de ${m.rate_basis.proposal_cohort} propostas enviadas no período`
                    : "nenhuma proposta enviada no período"
                }
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <div className="card p-4 lg:col-span-2">
                <h3 className="mb-3 text-sm font-semibold">Novos leads e contatos por dia</h3>
                <DailyChart data={m.daily} />
              </div>
              <div className="card p-4">
                <h3 className="mb-1 text-sm font-semibold">Onde estão seus leads agora</h3>
                <p className="mb-3 text-xs text-muted">Clique numa etapa para ver a lista.</p>
                <ul className="space-y-2 text-sm">
                  {STAGES.map((s) => (
                    <li key={s} className="flex justify-between">
                      <Link href={`/leads?etapa=${s}`} className="text-muted hover:text-slate-200">{STAGE_LABEL[s]}</Link>
                      <span className="tabular-nums">{m.by_stage[s] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <details className="card p-4 text-sm">
              <summary className="cursor-pointer font-medium">Mais números</summary>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Total de leads" value={m.total_leads} />
                <Stat label="Ações de contato" value={m.contact_actions} hint="mensagens/ligações registradas no período" />
                <Stat label="Desqualificados" value={m.disqualified} hint="fora do perfil" />
                <Stat label="Duplicados bloqueados" value={m.duplicates_blocked} hint="cadastros repetidos que o sistema barrou" />
              </div>
              <p className="mt-3 text-xs text-muted">
                {m.contacted_total} leads já contatados no total; {m.contacted_undated} vieram da planilha sem data de contato
                e por isso não entram em nenhum período.
              </p>
            </details>
          </section>
        </div>
      )}
    </>
  );
}

function rateHint(part: number, base: number, verb: string) {
  if (!base) return "ninguém recebeu o 1º contato no período";
  return `${part} de ${base} que receberam o 1º contato no período ${verb}`;
}

function ActionCard({
  href,
  number,
  title,
  text,
  alert,
}: {
  href: string;
  number: number;
  title: string;
  text: string;
  alert?: boolean;
}) {
  return (
    <Link href={href} className="card flex items-center gap-4 p-4 transition hover:border-accent/60 md:block">
      <div className={`w-12 shrink-0 text-center text-3xl font-semibold tabular-nums md:w-auto md:text-left ${alert ? "text-rose-300" : ""}`}>{number}</div>
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <p className="mt-1 text-xs text-muted">{text}</p>
      </div>
    </Link>
  );
}

function Score({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted">sem nota</span>;
  const color = value >= 70 ? "text-emerald-300" : value >= 40 ? "text-amber-300" : "text-rose-300";
  return (
    <div className="text-right">
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">potencial</div>
    </div>
  );
}

function Funnel({ steps }: { steps: { label: string; value: number; help: string }[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="card space-y-2 p-4">
      {steps.map((s) => (
        <div key={s.label} className="grid grid-cols-[110px_1fr_2.5rem] items-center gap-2 text-sm sm:grid-cols-[170px_1fr_3rem] sm:gap-3">
          <div>
            <div>{s.label}</div>
            <div className="text-xs text-muted">{s.help}</div>
          </div>
          <div className="h-3 rounded-full bg-panel-2">
            <div className="h-3 rounded-full bg-accent/70" style={{ width: `${Math.max((s.value / max) * 100, s.value ? 4 : 0)}%` }} />
          </div>
          <span className="text-right font-semibold tabular-nums">{s.value}</span>
        </div>
      ))}
    </div>
  );
}
