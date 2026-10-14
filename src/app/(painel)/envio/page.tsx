import Link from "next/link";
import { ErrorBox, Fold, PageHeader, Stat } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { fmtDateTime, todaySP } from "@/lib/time";
import {
  ApprovalControl,
  ApproveButtons,
  CancelButton,
  OutreachSettingsForm,
  ReclassifyButton,
  RetryButton,
  SenderTokenForm,
  StylesControl,
  SwitchControls,
  TodayTargetForm,
  ReturnToSecretaryButton,
  type OutreachSettings,
} from "./Forms";
import { STYLE_LABEL, styleNote, type OutreachStyle } from "@/lib/envio/estilos";
import { ESTRATEGIAS, type Estrategia } from "@/lib/prospeccao/estrategias";

export const metadata = { title: "Envio automático" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pronta: "Na fila",
  enviando_saudacao: "Enviando saudação",
  saudacao_enviada: "Saudação enviada",
  enviando_mensagem: "Enviando mensagem",
  enviada: "Enviada",
  falhou: "Falhou",
  cancelada: "Cancelada",
};
const STATUS_COLOR: Record<string, string> = {
  pronta: "bg-slate-700 text-slate-100",
  enviando_saudacao: "bg-indigo-900/70 text-indigo-200",
  saudacao_enviada: "bg-indigo-900/70 text-indigo-200",
  enviando_mensagem: "bg-indigo-900/70 text-indigo-200",
  enviada: "bg-emerald-900/70 text-emerald-200",
  falhou: "bg-rose-950/70 text-rose-300",
  cancelada: "bg-zinc-800 text-zinc-400",
};

type Msg = {
  id: string;
  lead_id: string;
  status: string;
  body: string;
  compliment: string;
  pain: string;
  improvement: string;
  greeting: string | null;
  greeting_sent_at: string | null;
  sent_at: string | null;
  error: string | null;
  cancel_reason: string | null;
  created_at: string;
  style: OutreachStyle;
  reply_body_at: string | null;
  strategy: Estrategia | null;
  strategy_reason: string | null;
  approved_at: string | null;
  body_approved_at: string | null;
  leads: { business_name: string; city: string } | null;
};
type Reply = {
  id: string;
  lead_id: string;
  body: string;
  received_at: string;
  kind: "automatica" | "humana";
  reason: string | null;
  opt_out: boolean;
  media: string;
  leads: { business_name: string } | null;
};

type SecretaryMsg = {
  id: string;
  lead_id: string;
  status: string;
  body: string;
  sent_at: string | null;
  created_at: string;
  error: string | null;
  cancel_reason: string | null;
  approved_at: string | null;
  leads: { business_name: string } | null;
};
const SECRETARY_STATUS: Record<string, string> = {
  pronta: "esperando a vez",
  enviando: "saindo",
  enviada: "enviada",
  falhou: "falhou (não reenvia)",
  cancelada: "cancelada",
};

// A fila aparece em três grupos que abrem com a setinha.
const FILA_GRUPOS = [
  { title: "⏳ Na fila", status: ["pronta", "enviando_saudacao"], hint: "esperando a vez" },
  { title: "📤 Enviadas", status: ["saudacao_enviada", "enviando_mensagem", "enviada"], hint: "saudação ou mensagem já saiu" },
  { title: "❌ Falhas e canceladas", status: ["falhou", "cancelada"], hint: "nada é reenviado sozinho" },
] as const satisfies readonly { title: string; status: readonly string[]; hint: string }[];

function MsgItem({ m }: { m: Msg }) {
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/leads/${m.lead_id}`} className="font-medium hover:underline">{m.leads?.business_name ?? "Lead"}</Link>
          <span className="text-xs text-muted"> · {m.leads?.city}</span>{" "}
          <span className={`badge ${STATUS_COLOR[m.status] ?? ""}`}>{STATUS_LABEL[m.status] ?? m.status}</span>{" "}
          <span className="badge">{STYLE_LABEL[m.style] ?? m.style}</span>{" "}
          <StrategyBadge e={m.strategy} />
          <span className="text-xs text-muted">
            {m.sent_at ? ` · enviada ${fmtDateTime(m.sent_at)}` : m.greeting_sent_at ? ` · saudação ${fmtDateTime(m.greeting_sent_at)}` : ` · escrita ${fmtDateTime(m.created_at)}`}
          </span>
        </div>
        {["pronta", "saudacao_enviada", "falhou"].includes(m.status) && <CancelButton id={m.id} />}
      </div>
      <div className="mt-2 rounded-lg bg-panel-2 p-3">
        <p className="text-xs text-muted">{m.greeting ?? "Saudação (bom dia / boa tarde / boa noite) definida na hora do envio"}</p>
        {styleNote(m.style, m.reply_body_at) && <p className="mt-1 text-xs text-amber-300">{styleNote(m.style, m.reply_body_at)}</p>}
        <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
      </div>
      <p className="mt-1 text-xs text-muted">Fato usado: {m.compliment} · Dor: {m.pain} · Melhoria: {m.improvement}</p>
      {m.strategy_reason && <p className="mt-1 text-xs text-muted">Por que {m.strategy}: {m.strategy_reason}</p>}
      {m.error && <p className="mt-1 text-xs text-rose-300">{m.error}</p>}
      {m.cancel_reason && m.status === "cancelada" && <p className="mt-1 text-xs text-muted">{m.cancel_reason}</p>}
    </li>
  );
}

function StrategyBadge({ e }: { e: Estrategia | null }) {
  if (!e) return <span className="badge bg-zinc-800 text-zinc-400">abordagem antiga</span>;
  return <span className="badge bg-violet-900/70 text-violet-200">{e} · {ESTRATEGIAS[e].nome}</span>;
}

/** Itens parados na trava de aprovação. */
function precisaAprovar(m: Msg): "mensagem" | "texto" | null {
  if (m.status === "pronta" && !m.approved_at) return "mensagem";
  if (m.status === "saudacao_enviada" && !m.sent_at && !m.body_approved_at && (m.style === "agradecimento" || m.reply_body_at)) return "texto";
  return null;
}

export default async function EnvioPage() {
  const { supabase } = await requireAdmin();
  const [settings, queue, replies, flagged, activity, handoffs, secretary] = await Promise.all([
    supabase.from("outreach_settings").select("*").eq("id", 1).maybeSingle(),
    supabase
      .from("outreach_messages")
      .select("id, lead_id, status, body, compliment, pain, improvement, greeting, greeting_sent_at, sent_at, error, cancel_reason, created_at, style, reply_body_at, strategy, strategy_reason, approved_at, body_approved_at, leads(business_name, city)")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("outreach_replies")
      .select("id, lead_id, body, received_at, kind, reason, opt_out, media, leads(business_name)")
      .order("received_at", { ascending: false })
      .limit(40),
    supabase
      .from("leads")
      .select("id, business_name, city, outreach_failures, outreach_last_error, outreach_last_error_at")
      .gt("outreach_failures", 0)
      .order("outreach_last_error_at", { ascending: false })
      .limit(30),
    supabase.rpc("dashboard_activity"),
    supabase
      .from("leads")
      .select("id, business_name, city, secretary_handoff_at, secretary_handoff_reason")
      .not("secretary_handoff_at", "is", null)
      .order("secretary_handoff_at", { ascending: false })
      .limit(30),
    supabase
      .from("outreach_secretary")
      .select("id, lead_id, status, body, sent_at, created_at, error, cancel_reason, approved_at, leads(business_name)")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const s = settings.data as (OutreachSettings & { next_send_at: string | null }) | null;
  const msgs = (queue.data ?? []) as unknown as Msg[];
  const reps = (replies.data ?? []) as unknown as Reply[];
  const counts = activity.data as { sent_today: number; ready_count: number; human_today: number } | null;
  const todayTarget = s?.today_new_leads_date === todaySP() && s.today_new_leads_target != null
    ? s.today_new_leads_target : s?.daily_limit ?? 0;

  const state = !s ? "—" : !s.enabled ? "Desligado" : s.paused ? "Pausado" : "Ligado";
  const toApprove = msgs.map((m) => ({ m, kind: precisaAprovar(m) })).filter((x) => x.kind);
  const repliesToApprove = ((secretary.data ?? []) as unknown as SecretaryMsg[]).filter((m) => m.status === "pronta" && !m.approved_at);
  const stateColor = !s?.enabled ? "text-slate-300" : s.paused ? "text-amber-300" : "text-emerald-300";

  return (
    <>
      <PageHeader
        title="💬 Envio automático"
        subtitle="Saudação, mensagem personalizada e secretário. Clique numa seção para abrir."
      />
      {settings.error || activity.error || !s || !counts ? (
        <ErrorBox message={dbErrorMessage(settings.error ?? activity.error) || "Configuração do envio não encontrada."} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Chave global" value={<span className={stateColor}>{state}</span>} hint={s.next_send_at ? `próximo lead a partir de ${fmtDateTime(s.next_send_at)}` : undefined} />
            <Stat label="Novos contatos hoje" value={`${counts.sent_today} / ${todayTarget}`} />
            <Stat label="Na fila" value={counts.ready_count} />
            <Stat label="Respostas de pessoas hoje" value={counts.human_today} />
          </div>

          {counts.ready_count === 0 && (
            <section className="card p-4" aria-label="Preparação da fila">
              <h2 className="text-sm font-semibold">Aguardando mensagens preparadas</h2>
              <p className="mt-2 text-sm text-muted">
                A fila é preenchida pelo Hermes no seu PC, com mensagens dos leads aptos.
                Mantenha o PC ligado e aguarde a preparação. A chave de envio libera as mensagens
                prontas dentro dos horários configurados.
              </p>
              <p className="mt-2 text-sm text-muted">
                Se a fila continuar vazia, abra o atalho “Ativar fila MKTech” na área de trabalho do PC
                e atualize esta página após alguns minutos. Se não houver leads aptos, solicite
                mais leads em <Link href="/execucoes" className="text-primary hover:underline">Pesquisas do Hermes</Link>.
              </p>
            </section>
          )}

          <TodayTargetForm key={`${todaySP()}-${todayTarget}`} target={todayTarget} sent={counts.sent_today} enabled={s.enabled} paused={s.paused} />

          <section className="card p-4">
            <h2 className="mb-1 text-sm font-semibold">Chave do envio</h2>
            <p className="mb-4 text-xs text-muted">
              Desligado ou pausado, o enviador não manda nada, nem a mensagem de quem já recebeu a saudação. A pausa vale na hora.
            </p>
            <SwitchControls s={s} />
          </section>

          {s.require_approval && (
            <Fold
              title="✅ Aguardando sua aprovação"
              count={toApprove.length + repliesToApprove.length}
              hint="nada destes sai antes do seu clique"
              open
              tone="border border-violet-900"
            >
              {toApprove.length + repliesToApprove.length === 0 ? (
                <p className="text-sm text-muted">Nada esperando aprovação.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {toApprove.map(({ m, kind }) => (
                    <li key={m.id} className="space-y-2 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Link href={`/leads/${m.lead_id}`} className="font-medium hover:underline">{m.leads?.business_name ?? "Lead"}</Link>
                          <span className="text-xs text-muted"> · {kind === "mensagem" ? "primeira mensagem" : "texto depois da saudação"}</span>{" "}
                          <StrategyBadge e={m.strategy} />
                        </div>
                        <ApproveButtons kind={kind!} id={m.id} />
                      </div>
                      <div className="rounded-lg bg-panel-2 p-3">
                        {kind === "mensagem" && <p className="text-xs text-muted">Antes vai a saudação (bom dia / boa tarde / boa noite); o texto abaixo só sai depois que uma pessoa responder.</p>}
                        <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                      </div>
                      {m.strategy_reason && <p className="text-xs text-muted">Por que {m.strategy}: {m.strategy_reason}</p>}
                    </li>
                  ))}
                  {repliesToApprove.map((m) => (
                    <li key={m.id} className="space-y-2 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Link href={`/conversas?lead=${m.lead_id}`} className="font-medium hover:underline">{m.leads?.business_name ?? "Lead"}</Link>
                          <span className="text-xs text-muted"> · resposta do secretário</span>
                        </div>
                        <ApproveButtons kind="resposta" id={m.id} />
                      </div>
                      <p className="whitespace-pre-wrap rounded-lg bg-panel-2 p-3">{m.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Fold>
          )}

          {(flagged.data?.length ?? 0) > 0 && (
            <Fold title="⚠️ Precisa de atenção" count={flagged.data!.length} open tone="border border-rose-900">
              <p className="mb-3 text-xs text-muted">
                A mensagem escrita pelo Hermes para estes leads não passou na validação, então nada foi enviado. Com 3 recusas o lead
                sai da fila até você liberar.
              </p>
              <ul className="divide-y divide-line">
                {flagged.data!.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                    <div className="min-w-0">
                      <Link href={`/leads/${l.id}`} className="font-medium hover:underline">{l.business_name}</Link>
                      <span className="text-xs text-muted"> · {l.city} · {l.outreach_failures} recusa(s) · {fmtDateTime(l.outreach_last_error_at)}</span>
                      <p className="mt-1 text-xs text-rose-300">{l.outreach_last_error}</p>
                    </div>
                    {l.outreach_failures >= 3 && <RetryButton id={l.id} />}
                  </li>
                ))}
              </ul>
            </Fold>
          )}

          <Fold
            title="🤝 Secretário"
            count={handoffs.data?.length ?? 0}
            hint={s.secretary_enabled ? "ligado" : "desligado"}
            open={(handoffs.data?.length ?? 0) > 0}
          >
            <p className="mb-3 text-xs text-muted">
              {s.secretary_enabled
                ? `Ligado: responde as clientes das ${s.reply_window_start ?? 8}h às ${s.reply_window_end ?? 18}h, sem limite de mensagens.`
                : "Desligado: quando uma cliente responde a mensagem personalizada, a conversa é sua."}
            </p>
            {(handoffs.data?.length ?? 0) > 0 && (
              <>
                <h3 className="mb-1 text-xs font-semibold uppercase text-muted">Conversas com você</h3>
                <ul className="mb-4 divide-y divide-line">
                  {handoffs.data!.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                      <div className="min-w-0">
                        <Link href={`/leads/${l.id}`} className="font-medium hover:underline">{l.business_name}</Link>
                        <span className="text-xs text-muted"> · {l.city} · {fmtDateTime(l.secretary_handoff_at)}</span>
                        <p className="mt-1 text-xs text-amber-300">{l.secretary_handoff_reason}</p>
                      </div>
                      <ReturnToSecretaryButton id={l.id} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {(secretary.data?.length ?? 0) > 0 ? (
              <>
                <h3 className="mb-1 text-xs font-semibold uppercase text-muted">Últimas respostas do secretário</h3>
                <ul className="divide-y divide-line">
                  {(secretary.data as unknown as SecretaryMsg[]).map((m) => (
                    <li key={m.id} className="py-3 text-sm">
                      <Link href={`/leads/${m.lead_id}`} className="font-medium hover:underline">{m.leads?.business_name ?? "Lead"}</Link>
                      <span className="text-xs text-muted"> · {SECRETARY_STATUS[m.status] ?? m.status} · {fmtDateTime(m.sent_at ?? m.created_at)}</span>
                      <p className="mt-1 whitespace-pre-wrap text-slate-300">{m.body}</p>
                      {(m.error || m.cancel_reason) && <p className="mt-1 text-xs text-muted">{m.error ?? m.cancel_reason}</p>}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted">O secretário ainda não respondeu ninguém.</p>
            )}
          </Fold>

          <Fold title="📥 Respostas" count={reps.length} hint={`${reps.filter((r) => r.kind === "humana").length} de pessoas nas últimas ${reps.length}`}>
            {replies.error ? (
              <ErrorBox message={dbErrorMessage(replies.error)} />
            ) : reps.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma resposta ainda.</p>
            ) : (
              <ul className="divide-y divide-line">
                {reps.map((r) => (
                  <li key={r.id} className="py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Link href={`/leads/${r.lead_id}`} className="font-medium hover:underline">{r.leads?.business_name ?? "Lead"}</Link>
                        <span className="text-xs text-muted"> · {fmtDateTime(r.received_at)}</span>{" "}
                        {r.kind === "humana" ? (
                          <span className="badge bg-sky-900/70 text-sky-200">
                            Pessoa{r.opt_out ? " · pediu para parar" : ""}{r.media === "audio" ? " · mandou áudio" : ""}
                          </span>
                        ) : (
                          <span className="badge bg-zinc-800 text-zinc-400">Automática</span>
                        )}
                      </div>
                      <ReclassifyButton id={r.id} to={r.kind === "humana" ? "automatica" : "humana"} />
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-slate-300">{r.body}</p>
                    {r.reason && <p className="mt-1 text-xs text-muted">Motivo: {r.reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Fold>

          {queue.error ? (
            <ErrorBox message={dbErrorMessage(queue.error)} />
          ) : msgs.length === 0 ? (
            <p className="card p-4 text-sm text-muted">Nenhuma mensagem escrita ainda. O Hermes escreve para os leads com diagnóstico e telefone.</p>
          ) : (
            <>
              {FILA_GRUPOS.map((g) => {
                const items = msgs.filter((m) => (g.status as readonly string[]).includes(m.status));
                return (
                  <Fold key={g.title} title={g.title} count={items.length} hint={g.hint}>
                    {items.length === 0 ? (
                      <p className="text-sm text-muted">Nada aqui.</p>
                    ) : (
                      <ul className="divide-y divide-line">
                        {items.map((m) => (
                          <MsgItem key={m.id} m={m} />
                        ))}
                      </ul>
                    )}
                  </Fold>
                );
              })}
            </>
          )}

          <Fold title="⚙️ Regras do envio" hint="horários, intervalos e limites">
            <p className="mb-4 text-xs text-muted">
              Um lead e um telefone recebem no máximo uma abordagem automática. Se o enviador não confirmar uma etapa, ela não é reenviada.
            </p>
            <OutreachSettingsForm s={s} />
          </Fold>

          <Fold title="🛡️ Trava de aprovação" hint={s.require_approval ? "ligada" : "desligada"}>
            <ApprovalControl s={s} />
          </Fold>

          <Fold title="✍️ Estilo da mensagem" hint={s.message_styles === "alternar" ? "alternando" : "só agradecimento"}>
            <StylesControl s={s} />
          </Fold>

          <Fold title="🔑 Token do enviador">
            <p className="mb-4 text-xs text-muted">Token separado do Hermes: só pede a próxima mensagem, confirma envios e registra respostas.</p>
            <SenderTokenForm />
          </Fold>
        </div>
      )}
    </>
  );
}
