import Link from "next/link";
import { ErrorBox, PageHeader, Stat } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { fmtDateTime, todaySP } from "@/lib/time";
import {
  CancelButton,
  OutreachSettingsForm,
  ReclassifyButton,
  RetryButton,
  SenderTokenForm,
  SwitchControls,
  type OutreachSettings,
} from "./Forms";

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
  leads: { business_name: string } | null;
};

export default async function EnvioPage() {
  const { supabase } = await requireAdmin();
  const dayStart = new Date(`${todaySP()}T00:00:00-03:00`).toISOString();
  const [settings, queue, replies, flagged, sentToday] = await Promise.all([
    supabase.from("outreach_settings").select("*").eq("id", 1).maybeSingle(),
    supabase
      .from("outreach_messages")
      .select("id, lead_id, status, body, compliment, pain, improvement, greeting, greeting_sent_at, sent_at, error, cancel_reason, created_at, leads(business_name, city)")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("outreach_replies")
      .select("id, lead_id, body, received_at, kind, reason, opt_out, leads(business_name)")
      .order("received_at", { ascending: false })
      .limit(40),
    supabase
      .from("leads")
      .select("id, business_name, city, outreach_failures, outreach_last_error, outreach_last_error_at")
      .gt("outreach_failures", 0)
      .order("outreach_last_error_at", { ascending: false })
      .limit(30),
    supabase.from("outreach_messages").select("id", { count: "exact", head: true }).gte("greeting_sent_at", dayStart),
  ]);

  const s = settings.data as (OutreachSettings & { next_send_at: string | null }) | null;
  const msgs = (queue.data ?? []) as unknown as Msg[];
  const reps = (replies.data ?? []) as unknown as Reply[];
  const waiting = msgs.filter((m) => m.status === "pronta").length;
  const humans = reps.filter((r) => r.kind === "humana").length;

  const state = !s ? "—" : !s.enabled ? "Desligado" : s.paused ? "Pausado" : "Ligado";
  const stateColor = !s?.enabled ? "text-slate-300" : s.paused ? "text-amber-300" : "text-emerald-300";

  return (
    <>
      <PageHeader
        title="Envio automático"
        subtitle="O Hermes escreve a primeira mensagem a partir do diagnóstico; o enviador do PC manda a saudação e depois a mensagem. Ninguém responde o cliente sozinho: quando uma pessoa responde, a conversa é sua."
      />
      {settings.error || !s ? (
        <ErrorBox message={dbErrorMessage(settings.error) || "Configuração do envio não encontrada."} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Chave global" value={<span className={stateColor}>{state}</span>} hint={s.next_send_at ? `próximo lead a partir de ${fmtDateTime(s.next_send_at)}` : undefined} />
            <Stat label="Abordados hoje" value={`${sentToday.count ?? 0} / ${s.daily_limit}`} />
            <Stat label="Na fila" value={waiting} />
            <Stat label="Responderam (pessoa)" value={humans} hint="nas últimas respostas" />
          </div>

          <section className="card p-4">
            <h2 className="mb-1 text-sm font-semibold">Chave do envio</h2>
            <p className="mb-4 text-xs text-muted">
              Desligado ou pausado, o enviador não manda nada, nem a mensagem de quem já recebeu a saudação. A pausa vale na hora.
            </p>
            <SwitchControls s={s} />
          </section>

          {(flagged.data?.length ?? 0) > 0 && (
            <section className="card p-4">
              <h2 className="mb-1 text-sm font-semibold">Precisa de atenção</h2>
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
            </section>
          )}

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold">Respostas</h2>
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
                          <span className="badge bg-sky-900/70 text-sky-200">Pessoa{r.opt_out ? " · pediu para parar" : ""}</span>
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
          </section>

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold">Fila e histórico</h2>
            {queue.error ? (
              <ErrorBox message={dbErrorMessage(queue.error)} />
            ) : msgs.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma mensagem escrita ainda. O Hermes escreve para os leads com diagnóstico e telefone.</p>
            ) : (
              <ul className="divide-y divide-line">
                {msgs.map((m) => (
                  <li key={m.id} className="py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Link href={`/leads/${m.lead_id}`} className="font-medium hover:underline">{m.leads?.business_name ?? "Lead"}</Link>
                        <span className="text-xs text-muted"> · {m.leads?.city}</span>{" "}
                        <span className={`badge ${STATUS_COLOR[m.status] ?? ""}`}>{STATUS_LABEL[m.status] ?? m.status}</span>
                        <span className="text-xs text-muted">
                          {m.sent_at ? ` · enviada ${fmtDateTime(m.sent_at)}` : m.greeting_sent_at ? ` · saudação ${fmtDateTime(m.greeting_sent_at)}` : ` · escrita ${fmtDateTime(m.created_at)}`}
                        </span>
                      </div>
                      {["pronta", "saudacao_enviada", "falhou"].includes(m.status) && <CancelButton id={m.id} />}
                    </div>
                    <div className="mt-2 rounded-lg bg-panel-2 p-3">
                      <p className="text-xs text-muted">{m.greeting ?? "Saudação (bom dia / boa tarde / boa noite) definida na hora do envio"}</p>
                      <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted">Elogio: {m.compliment} · Dor: {m.pain} · Melhoria: {m.improvement}</p>
                    {m.error && <p className="mt-1 text-xs text-rose-300">{m.error}</p>}
                    {m.cancel_reason && m.status === "cancelada" && <p className="mt-1 text-xs text-muted">{m.cancel_reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-4">
            <h2 className="mb-1 text-sm font-semibold">Regras do envio</h2>
            <p className="mb-4 text-xs text-muted">
              Um lead e um telefone recebem no máximo uma abordagem automática. Se o enviador não confirmar uma etapa, ela não é reenviada.
            </p>
            <OutreachSettingsForm s={s} />
          </section>

          <section className="card p-4">
            <h2 className="mb-1 text-sm font-semibold">Token do enviador</h2>
            <p className="mb-4 text-xs text-muted">Token separado do Hermes: só pede a próxima mensagem, confirma envios e registra respostas.</p>
            <SenderTokenForm />
          </section>
        </div>
      )}
    </>
  );
}
