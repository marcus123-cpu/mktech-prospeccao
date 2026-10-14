import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { ErrorBox, Fold, PageHeader, Stat } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { fmtDateTime, todaySP } from "@/lib/time";
import {
  CancelButton,
  OutreachSettingsForm,
  ReclassifyButton,
  RetryButton,
  SenderTokenForm,
  StylesControl,
  SwitchControls,
  TodayTargetForm,
  ReturnToSecretaryButton,
  RemoveCommercialLeadButton,
  type OutreachSettings,
} from "./Forms";
import { STYLE_LABEL, styleNote, type OutreachStyle } from "@/lib/envio/estilos";
import { pauseNewContacts } from "../comercial/actions";

export const metadata = { title: "Central de disparos" };
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
  leads: { business_name: string } | null;
};
type CommercialMessage = {
  id: string;
  lead_id: string;
  kind: string;
  status: string;
  body: string;
  due_at: string;
  sent_at: string | null;
  created_at: string;
  error: string | null;
  leads: { business_name: string; city: string } | null;
};
const COMMERCIAL_STATUS: Record<string, string> = {
  enfileirada: "Na fila", enviando: "Enviando", enviada: "Enviada", entregue: "Entregue",
  falhou: "Falhou", desconhecido: "Verificar envio", cancelada: "Cancelada", criada: "Preparando",
};
const COMMERCIAL_KIND: Record<string, string> = {
  initial: "Primeiro contato", reply: "Resposta", followup: "Retorno", demo: "Demonstração",
  video: "Vídeo", proposal: "Proposta",
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
          <span className="badge">{STYLE_LABEL[m.style] ?? m.style}</span>
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
      <p className="mt-1 text-xs text-muted">Elogio: {m.compliment} · Dor: {m.pain} · Melhoria: {m.improvement}</p>
      {m.error && <p className="mt-1 text-xs text-rose-300">{m.error}</p>}
      {m.cancel_reason && m.status === "cancelada" && <p className="mt-1 text-xs text-muted">{m.cancel_reason}</p>}
    </li>
  );
}

export default async function EnvioPage() {
  const { supabase } = await requireAdmin();
  const [settings, queue, replies, flagged, activity, handoffs, secretary, commercial, commercialQueue, commercialRecent, commercialPending, commercialSent] = await Promise.all([
    supabase.from("outreach_settings").select("*").eq("id", 1).maybeSingle(),
    supabase
      .from("outreach_messages")
      .select("id, lead_id, status, body, compliment, pain, improvement, greeting, greeting_sent_at, sent_at, error, cancel_reason, created_at, style, reply_body_at, leads(business_name, city)")
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
      .select("id, lead_id, status, body, sent_at, created_at, error, cancel_reason, leads(business_name)")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("commercial_settings").select("enabled,channel_authorized,test_mode,new_contacts_enabled,bridge_connected,last_worker_at,last_sender_at,engine_version").eq("id", 1).maybeSingle(),
    supabase.from("commercial_outbox").select("id,lead_id,kind,status,body,due_at,sent_at,created_at,error,leads(business_name,city)").eq("status", "enfileirada").order("due_at").limit(100),
    supabase.from("commercial_outbox").select("id,lead_id,kind,status,body,due_at,sent_at,created_at,error,leads(business_name,city)").neq("status", "enfileirada").order("created_at", { ascending: false }).limit(12),
    supabase.from("commercial_outbox").select("id", { count: "exact", head: true }).eq("status", "enfileirada"),
    supabase.from("commercial_outbox").select("id", { count: "exact", head: true }).eq("kind", "initial").gte("sent_at", `${todaySP()}T03:00:00Z`),
  ]);

  const s = settings.data as (OutreachSettings & { next_send_at: string | null }) | null;
  const msgs = (queue.data ?? []) as unknown as Msg[];
  const reps = (replies.data ?? []) as unknown as Reply[];
  const counts = activity.data as { sent_today: number; ready_count: number; human_today: number } | null;
  const c = commercial.data;
  const commercialMsgs = (commercialQueue.data ?? []) as unknown as CommercialMessage[];
  const queued = commercialMsgs;
  const recent = (commercialRecent.data ?? []) as unknown as CommercialMessage[];
  const todayTarget = s?.today_new_leads_date === todaySP() && s.today_new_leads_target != null
    ? s.today_new_leads_target : s?.daily_limit ?? 0;

  const state = !s ? "—" : !s.enabled ? "Desligado" : s.paused ? "Pausado" : "Ligado";
  const stateColor = !s?.enabled ? "text-slate-300" : s.paused ? "text-amber-300" : "text-emerald-300";

  return (
    <>
      <PageHeader
        title="Central de disparos"
        subtitle="Fila real do Hermes, horário, limites e atendimento em um só lugar. Horários de São Paulo."
      />
      {settings.error || activity.error || commercial.error || commercialQueue.error || commercialRecent.error || commercialPending.error || commercialSent.error || !s || !counts || !c ? (
        <ErrorBox message={dbErrorMessage(settings.error ?? activity.error ?? commercial.error ?? commercialQueue.error ?? commercialRecent.error ?? commercialPending.error ?? commercialSent.error) || "Configuração do envio não encontrada."} />
      ) : (
        <div className="space-y-6">
          <section className="card overflow-hidden border-accent/35 bg-gradient-to-br from-panel via-panel to-accent/10 p-5 md:p-6" aria-label="Estado da operação">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">Operação agora</p>
                <h2 className="mt-2 text-xl font-semibold md:text-2xl">{!s.enabled || s.paused || !c.enabled || !c.channel_authorized ? "Envios suspensos" : c.bridge_connected === false ? "WhatsApp desconectado" : !c.new_contacts_enabled ? "Novas abordagens pausadas" : "Hermes pronto para prospectar"}</h2>
                <p className="mt-2 text-sm text-muted">{c.test_mode ? "Modo teste" : "Contatos reais"} · WhatsApp {c.bridge_connected === true ? "conectado" : c.bridge_connected === false ? "desconectado" : "sem confirmação"} · Motor {c.engine_version?.toUpperCase() ?? "comercial"}</p>
              </div>
              <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${s.enabled && !s.paused && c.enabled && c.channel_authorized && c.new_contacts_enabled && c.bridge_connected !== false ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>{s.enabled && !s.paused && c.enabled && c.channel_authorized && c.new_contacts_enabled && c.bridge_connected !== false ? "Novos contatos liberados" : "Novos contatos retidos"}</span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-bg/35 p-3"><p className="text-xs text-muted">Próximo horário permitido</p><p className="mt-1 font-medium">{s.window_start}h–{s.window_end}h · {s.send_days.map((d) => ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][d]).join(", ")}</p></div>
              <div className="rounded-xl border border-line bg-bg/35 p-3"><p className="text-xs text-muted">Próximo envio / último sinal</p><p className="mt-1 text-sm font-medium">{s.next_send_at ? fmtDateTime(s.next_send_at) : "Sem horário agendado"}</p><p className="mt-1 text-xs text-muted">Ponte: {fmtDateTime(c.last_sender_at)}</p></div>
              <div className="rounded-xl border border-line bg-bg/35 p-3"><p className="text-xs text-muted">Atendimento de clientes</p><p className="mt-1 font-medium">{s.secretary_enabled && s.enabled && !s.paused ? "Ligado" : "Pausado"} · {s.reply_window_start ?? 8}h–{s.reply_window_end ?? 18}h</p></div>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Na fila do V6" value={commercialPending.count ?? 0} hint="Mensagens pendentes reais" />
            <Stat label="Primeiros contatos hoje" value={`${commercialSent.count ?? 0} / ${todayTarget}`} />
            <Stat label="Respostas humanas hoje" value={counts.human_today} />
            <Stat label="Ponte WhatsApp" value={<span className={c.bridge_connected ? "text-emerald-300" : "text-amber-300"}>{c.bridge_connected ? "Conectada" : "Verificar"}</span>} />
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,1fr)]">
            <section className="card p-5" aria-label="Controles de prospecção">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Novas abordagens</h2><p className="mt-1 text-sm text-muted">Pare ou retome o primeiro contato. O secretário continua atendendo as conversas existentes.</p></div><span className={`badge ${c.new_contacts_enabled ? "bg-emerald-900/70 text-emerald-200" : "bg-amber-900/70 text-amber-200"}`}>{c.new_contacts_enabled ? "Liberadas" : "Pausadas"}</span></div>
              <div className="mt-4"><ActionForm action={pauseNewContacts} submit={c.new_contacts_enabled ? "Pausar novas abordagens" : "Retomar novas abordagens"} variant={c.new_contacts_enabled ? "btn-danger" : "btn-primary"} confirmText={c.new_contacts_enabled ? undefined : "Retomar novas abordagens para os contatos elegíveis dentro do horário e limite diário?"}><input type="hidden" name="enabled" value={String(!c.new_contacts_enabled)} /></ActionForm></div>
              <div className="mt-5 border-t border-line pt-4"><TodayTargetForm key={`${todaySP()}-${todayTarget}`} target={todayTarget} sent={commercialSent.count ?? 0} enabled={s.enabled} paused={s.paused} /></div>
            </section>
            <section className="card p-5" aria-label="Como funciona o primeiro contato"><h2 className="text-lg font-semibold">Primeiro contato sem pressão</h2><ol className="mt-4 space-y-3 text-sm"><li className="rounded-lg bg-panel-2 p-3"><span className="mr-2 text-violet-300">01</span> Hermes envia apenas “Olá, bom dia/boa tarde! Tudo bem?”</li><li className="rounded-lg bg-panel-2 p-3"><span className="mr-2 text-sky-300">02</span> Aguarda uma resposta da pessoa.</li><li className="rounded-lg bg-panel-2 p-3"><span className="mr-2 text-emerald-300">03</span> Continua com contexto, respeitando recusa e horário.</li></ol><Link href="/conversas" className="mt-4 inline-flex text-sm font-medium text-violet-300 hover:underline">Ver conversas →</Link></section>
          </div>

          <section className="card p-5" aria-label="Fila real de disparos"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Fila do Hermes V6</h2><p className="mt-1 text-sm text-muted">{commercialPending.count ?? 0} pendente(s) no total · mostrando {queued.length} por ordem de envio</p></div><Link href="/comercial" className="btn-ghost">Ver funil comercial</Link></div>
            {queued.length === 0 ? <p className="mt-4 rounded-lg bg-panel-2 p-4 text-sm text-muted">Nenhuma mensagem aguardando envio. O Hermes adiciona contatos elegíveis conforme a pesquisa e as regras configuradas.</p> : <ul className="mt-4 divide-y divide-line">{queued.map((m) => <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div className="min-w-0 flex-1"><Link href={`/comercial?lead=${m.lead_id}`} className="font-medium hover:underline">{m.leads?.business_name ?? "Lead"}</Link><p className="mt-1 text-xs text-muted">{m.leads?.city} · {COMMERCIAL_KIND[m.kind] ?? m.kind} · previsto {fmtDateTime(m.due_at)}</p><p className="mt-2 max-w-3xl whitespace-pre-wrap rounded-lg bg-panel-2 p-3 text-sm">{m.kind === "initial" ? "Saudação breve; texto definido pelo horário no momento do envio." : m.body}</p></div><RemoveCommercialLeadButton id={m.lead_id} /></li>)}</ul>}
          </section>

          <section className="card p-5" aria-label="Atividade recente"><h2 className="text-lg font-semibold">Atividade recente do V6</h2><p className="mt-1 text-sm text-muted">Confirme aqui o que saiu, falhou ou precisa de conferência.</p>{recent.length === 0 ? <p className="mt-4 text-sm text-muted">Ainda não há atividade.</p> : <ul className="mt-3 divide-y divide-line">{recent.map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><Link href={`/conversas?lead=${m.lead_id}`} className="font-medium hover:underline">{m.leads?.business_name ?? "Lead"}</Link><p className="mt-1 text-xs text-muted">{COMMERCIAL_KIND[m.kind] ?? m.kind} · {fmtDateTime(m.sent_at ?? m.created_at)}{m.error ? ` · ${m.error}` : ""}</p></div><span className={`badge ${["enviada", "entregue"].includes(m.status) ? "bg-emerald-900/70 text-emerald-200" : ["falhou", "desconhecido"].includes(m.status) ? "bg-amber-900/70 text-amber-200" : "bg-panel-2"}`}>{COMMERCIAL_STATUS[m.status] ?? m.status}</span></li>)}</ul>}</section>

          <Fold title="Controles gerais e atendimento" hint="pausa total, secretário e lembretes"><p className="mb-4 text-sm text-muted">A chave geral afeta os disparos e o atendimento automático. Use a pausa de novas abordagens acima para manter o secretário ativo. Estado geral: <span className={stateColor}>{state}</span>.</p><SwitchControls s={s} /></Fold>

          <Fold title="Horários, dias e limites" hint="ajustar a agenda de disparos">
            <p className="mb-4 text-sm text-muted">Defina quando o Hermes pode iniciar contatos e atender respostas. O fuso usado é São Paulo.</p>
            <OutreachSettingsForm s={s} />
          </Fold>

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

          <div className="border-t border-line pt-5"><h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Histórico do enviador anterior</h2>
          {queue.error ? (
            <ErrorBox message={dbErrorMessage(queue.error)} />
          ) : msgs.length === 0 ? (
            <p className="card p-4 text-sm text-muted">Nenhum registro no enviador anterior.</p>
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
          )}</div>

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
