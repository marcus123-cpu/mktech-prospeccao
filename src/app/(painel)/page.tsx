import Link from "next/link";
import { DailyChart } from "@/components/dashboard/DailyChart";
import { EnvioChart } from "@/components/dashboard/EnvioChart";
import { PeriodFilter } from "@/components/PeriodFilter";
import { ErrorBox, PageHeader, Stat } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { RUN_STATUS_LABEL, STAGE_LABEL, STAGES } from "@/lib/labels";
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

type Settings = {
  enabled: boolean;
  paused: boolean;
  daily_limit: number;
  today_new_leads_target?: number | null;
  today_new_leads_date?: string | null;
  window_start: number;
  window_end: number;
  send_days: number[];
  next_send_at: string | null;
  followups_enabled?: boolean;
  reply_window_start?: number;
  reply_window_end?: number;
  prospect_after_noon?: boolean;
};

type Activity = {
  sent_today: number;
  texts_today: number;
  human_today: number;
  optouts_today: number;
  ready_count: number;
  by_column: Record<string, number>;
  days: { day: string; saudacoes: number; respostas: number }[];
};

// Colunas do funil do envio, na ordem em que o lead anda.
const FUNIL: { key: string; label: string; color: string }[] = [
  { key: "fila", label: "📥 Na fila", color: "bg-slate-500" },
  { key: "enviado", label: "📤 Abordado", color: "bg-indigo-500" },
  { key: "aguardando", label: "⏳ Texto segurado", color: "bg-amber-500" },
  { key: "conversa", label: "💬 Em conversa", color: "bg-emerald-500" },
  { key: "valor", label: "💰 Pergunta de valor", color: "bg-fuchsia-500" },
  { key: "fechando", label: "🤝 Fechando", color: "bg-teal-500" },
  { key: "sem_resposta", label: "🔕 Sem resposta", color: "bg-zinc-500" },
  { key: "lembrando", label: "🔔 Lembrete enviado", color: "bg-sky-500" },
  { key: "sem_retorno", label: "💤 Sem retorno", color: "bg-stone-500" },
  { key: "atencao", label: "⚠️ Atenção", color: "bg-rose-500" },
];

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Dia da semana (0 = domingo) e hora em São Paulo. */
function agoraSP(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  const wd = parts.find((x) => x.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((x) => x.type === "hour")?.value ?? 0);
  return { dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), hour };
}

export default async function Hoje({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; inicio?: string; fim?: string }>;
}) {
  const sp = await searchParams;
  const key = (["hoje", "semana", "mes", "personalizado"].includes(sp.periodo ?? "") ? sp.periodo : "semana") as PeriodKey;
  const { start, end } = periodRange(key, new Date(), { start: sp.inicio, end: sp.fim });
  const { supabase } = await requireAdmin();

  const [metrics, settings, hermes, activity, stock, commercial, commercialQueue, commercialSent] = await Promise.all([
    supabase.rpc("dashboard_metrics", { p_start: start, p_end: end }),
    supabase.from("outreach_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("prospecting_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.rpc("dashboard_activity"),
    supabase.rpc("prospecting_stock"),
    supabase.from("commercial_settings").select("enabled,new_contacts_enabled,bridge_connected").eq("id", 1).maybeSingle(),
    supabase.from("commercial_outbox").select("id", { count: "exact", head: true }).eq("status", "enfileirada"),
    supabase.from("commercial_outbox").select("id", { count: "exact", head: true }).eq("kind", "initial").gte("sent_at", `${todaySP()}T03:00:00Z`),
  ]);
  const m = metrics.data as Metrics | null;
  const a = activity.data as Activity | null;
  const stockReady = typeof stock.data === "number" ? stock.data : null;
  const stockMin = (hermes.data as { restock_min?: number } | null)?.restock_min ?? 20;
  const env = settings.data as Settings | null;
  const todayTarget = env?.today_new_leads_date === todaySP() && env.today_new_leads_target != null
    ? env.today_new_leads_target : env?.daily_limit ?? 0;

  const porColuna = a?.by_column ?? {};
  const waitingOnYou = (porColuna.valor ?? 0) + (porColuna.conversa ?? 0);

  const semana = (a?.days ?? []).map((d) => ({
    label: `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}`,
    saudacoes: d.saudacoes,
    respostas: d.respostas,
  }));
  const pediramParar = a?.optouts_today ?? 0;

  const agora = agoraSP();
  const diaOk = !!env?.send_days.includes(agora.dow);
  const prospFim = env ? (env.prospect_after_noon ? Math.max(env.window_end, env.reply_window_end ?? 18) : env.window_end) : 0;
  const prospAberta = diaOk && !!env && agora.hour >= env.window_start && agora.hour < prospFim;
  const atendAberto = diaOk && !!env && agora.hour >= (env.reply_window_start ?? 8) && agora.hour < (env.reply_window_end ?? 18);
  const estadoCor = !env?.enabled ? "text-slate-300" : env.paused ? "text-amber-300" : "text-emerald-300";
  const janela = !env
    ? ""
    : `Prospecção ${prospAberta ? "aberta" : "fechada"} (${env.window_start}h às ${prospFim}h) · Atendimento ${atendAberto ? "aberto" : "fechado"} (${env.reply_window_start ?? 8}h às ${env.reply_window_end ?? 18}h) · ${env.send_days.map((d) => DIAS[d]).join(", ")}`;

  const today = todaySP();

  return (
    <>
      <PageHeader title="Visão geral" subtitle={`${fmtDate(`${today}T12:00:00Z`)} · acompanhe prospecção, conversas e oportunidades`} actions={<Link href="/envio" className="btn-primary">Controlar disparos</Link>} />

      {metrics.error || activity.error || commercial.error || commercialQueue.error || commercialSent.error || !m || !a || !commercial.data ? (
        <ErrorBox message={dbErrorMessage(metrics.error ?? activity.error ?? commercial.error ?? commercialQueue.error ?? commercialSent.error) || "Não foi possível carregar o painel."} />
      ) : (
        <div className="space-y-8">
          {/* 1. Robô agora */}
          {env && (
            <section className="card p-5 md:p-6">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">Operação agora</h2>
                <Link href="/envio" className="text-sm text-violet-300 hover:underline">Abrir central de disparos →</Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Novas abordagens" value={<span className={estadoCor}>{!env.enabled || env.paused || !commercial.data?.enabled ? "Suspensas" : commercial.data?.new_contacts_enabled ? "Liberadas" : "Pausadas"}</span>} hint={janela} />
                <Stat
                  label="Novos contatos hoje"
                  value={`${commercialSent.count ?? 0} / ${todayTarget}`}
                  hint={env.next_send_at && env.enabled ? `próximo lead a partir de ${fmtDateTime(env.next_send_at)}` : "meta definida por você"}
                />
                <Stat label="Fila real do Hermes" value={commercialQueue.count ?? 0} hint="Mensagens aguardando envio" />
                <Stat
                  label="Respostas de pessoas hoje"
                  value={a.human_today}
                  hint={pediramParar ? `${pediramParar} pediram para parar` : "ninguém pediu para parar"}
                />
              </div>
              <Link href="/envio#meta-do-dia" className="mt-4 inline-block text-sm text-accent hover:underline">Ajustar meta de disparos de hoje</Link>
            </section>
          )}

          {/* 2. O que precisa de você */}
          <section>
            <h2 className="mb-3 text-sm font-semibold">O que fazer agora</h2>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              <ActionCard
                href="/funil"
                number={waitingOnYou}
                title="clientes esperando você"
                text={`${porColuna.valor ?? 0} perguntaram valor e ${porColuna.conversa ?? 0} estão em conversa.`}
                alert={waitingOnYou > 0}
              />
              {stockReady !== null && (
                <ActionCard
                  href="/leads?etapa=novo&nao_contatados=1&ordem=potencial"
                  number={stockReady}
                  title={`leads prontos: ${stockReady} de ${stockMin}`}
                  text={
                    stockReady < stockMin
                      ? "Abaixo do mínimo: a próxima pesquisa do Hermes busca mais 20."
                      : "Estoque cheio: com WhatsApp, nota 60+ e diagnóstico."
                  }
                  alert={stockReady < stockMin}
                />
              )}
              <ActionCard
                href="/funil"
                number={porColuna.aguardando ?? 0}
                title="textos segurados"
                text="Saudação enviada; o texto só sai quando uma pessoa responder."
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

          {/* 3. Funil do envio e últimos 7 dias */}
          <section className="grid gap-3 lg:grid-cols-5">
            <div className="card p-4 lg:col-span-2">
              <h2 className="mb-3 text-sm font-semibold">Onde estão os leads do robô</h2>
              <ul className="space-y-2 text-sm">
                {FUNIL.filter((f) => f.key !== "lembrando" && f.key !== "sem_retorno" ? true : env?.followups_enabled !== undefined).map((f) => {
                  const n = porColuna[f.key] ?? 0;
                  const max = Math.max(...Object.values(porColuna), 1);
                  return (
                    <li key={f.key} className="grid grid-cols-[9.5rem_1fr_2rem] items-center gap-2">
                      <span className="text-muted">{f.label}</span>
                      <span className="h-2.5 rounded-full bg-panel-2">
                        <span className={`block h-2.5 rounded-full ${f.color}`} style={{ width: `${Math.max((n / max) * 100, n ? 4 : 0)}%` }} />
                      </span>
                      <span className="text-right font-semibold tabular-nums">{n}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="card p-4 lg:col-span-3">
              <h2 className="mb-3 text-sm font-semibold">Últimos 7 dias</h2>
              <EnvioChart data={semana} />
            </div>
          </section>

          {/* 3. Hermes */}
          <section className="card p-4 text-sm">
            <h2 className="mb-1 text-sm font-semibold">Hermes</h2>
            <p>
              Rotina diária{" "}
              {hermes.data?.routine_enabled ? (
                <span className="font-medium text-emerald-300">ligada</span>
              ) : (
                <span className="font-medium text-amber-300">pausada</span>
              )}
              {hermes.data && <> · meta de {hermes.data.daily_target} leads por dia</>}.{" "}
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
