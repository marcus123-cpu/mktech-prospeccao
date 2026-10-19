import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Empty, ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { fmtDateTime, TZ, todaySP } from "@/lib/time";
import { bulkAction, itemAction, pauseSending, resumeSending, setTodayTarget } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Central de envio" };

type Row = { id: string; kind: string; phone_e164: string; status: string; error: string | null; claimed_at: string | null; sent_at: string | null; created_at: string; due_at: string; leads: { business_name: string } | { business_name: string }[] | null };
const nameOf = (r: Row) => [r.leads].flat()[0]?.business_name ?? "Lead";
const DAYS = ["", "seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

/** Traduz o erro técnico da ponte para o que aconteceu de verdade. */
function why(r: Row) {
  const e = r.error ?? "";
  if (/detached frame|target closed|session closed|protocol error/i.test(e)) return "O navegador da ponte do WhatsApp travou na hora de enviar. A mensagem provavelmente não saiu.";
  if (/não tem whatsapp/i.test(e)) return "Esse número não tem WhatsApp.";
  if (/não está conectado/i.test(e)) return "O WhatsApp estava desconectado.";
  if (!e) return r.status === "falhou" ? "Falhou sem detalhe." : "O WhatsApp não confirmou o envio. Confira no celular se a mensagem saiu.";
  return e;
}

function Btn({ action, id, label, variant, confirm }: { action: "retry" | "cancel" | "sent"; id: string; label: string; variant: string; confirm?: string }) {
  return <ActionForm action={itemAction} submit={label} variant={`${variant} !px-3 !py-1.5 text-xs`} className="space-y-0" confirmText={confirm}>
    <input type="hidden" name="id" value={id} /><input type="hidden" name="action" value={action} />
  </ActionForm>;
}

function Bulk({ scope, action, label, variant, confirm }: { scope: "unknown" | "queue"; action: "retry" | "cancel" | "sent"; label: string; variant: string; confirm: string }) {
  return <ActionForm action={bulkAction} submit={label} variant={variant} className="space-y-0" confirmText={confirm}>
    <input type="hidden" name="scope" value={scope} /><input type="hidden" name="action" value={action} />
  </ActionForm>;
}

export default async function EnvioPage() {
  const { supabase } = await requireAdmin();
  const dayStart = new Date(`${todaySP()}T00:00:00-03:00`).toISOString();
  const cols = "id,kind,phone_e164,status,error,claimed_at,sent_at,created_at,due_at,leads(business_name)";
  const [commercial, outreach, unknown, queued, queuedCount, usedToday, sentRecent, campaigns] = await Promise.all([
    supabase.from("commercial_settings").select("enabled,channel_authorized,bridge_connected,last_sender_at,last_worker_at,test_mode").eq("id", 1).single(),
    supabase.from("outreach_settings").select("enabled,paused,window_start,window_end,send_days,daily_limit,next_send_at,today_new_leads_target,today_new_leads_date,min_delay_seconds,max_delay_seconds").eq("id", 1).single(),
    supabase.from("commercial_outbox").select(cols).in("status", ["desconhecido", "falhou"]).eq("simulated", false).gte("created_at", new Date(Date.now() - 3 * 86400000).toISOString()).order("claimed_at", { ascending: false, nullsFirst: false }).limit(100),
    supabase.from("commercial_outbox").select(cols).eq("status", "enfileirada").eq("simulated", false).order("due_at").limit(20),
    supabase.from("commercial_outbox").select("id", { count: "exact", head: true }).eq("status", "enfileirada").eq("simulated", false),
    supabase.from("commercial_outbox").select("status").eq("kind", "initial").eq("simulated", false).in("status", ["enviando", "enviada", "entregue", "desconhecido"]).or(`sent_at.gte.${dayStart},and(sent_at.is.null,claimed_at.gte.${dayStart})`).limit(1000),
    supabase.from("commercial_outbox").select(cols).in("status", ["enviada", "entregue"]).eq("simulated", false).order("sent_at", { ascending: false }).limit(12),
    supabase.from("commercial_campaigns").select("id,status").eq("mode", "autonomo").in("status", ["ativa", "pausada"]),
  ]);
  if (commercial.error || outreach.error) return <><PageHeader title="Central de envio" /><ErrorBox message="Não foi possível carregar os dados de envio." /></>;
  const c = commercial.data, o = outreach.data;
  const stuck = (unknown.data ?? []) as unknown as Row[];
  const next = (queued.data ?? []) as unknown as Row[];
  const used = (usedToday.data ?? []).length;
  const unconfirmed = (usedToday.data ?? []).filter(r => r.status === "desconhecido").length;
  const target = o.today_new_leads_date === todaySP() ? o.today_new_leads_target : Math.min(o.daily_limit, 5);
  const waiting = queuedCount.count ?? 0;

  const now = new Date();
  const hour = Number(now.toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }));
  const isoDay = Number(new Date(now.toLocaleString("en-US", { timeZone: TZ })).getDay()) || 7;
  const inWindow = hour >= o.window_start && hour < o.window_end && (o.send_days as number[]).includes(isoDay);
  const senderAge = c.last_sender_at ? (Date.now() - new Date(c.last_sender_at).getTime()) / 1000 : Infinity;
  const robotAlive = senderAge < 120;
  const pausedCampaigns = (campaigns.data ?? []).some(x => x.status === "pausada");
  const limitReached = used >= target;
  const paused = o.paused || (pausedCampaigns && !(campaigns.data ?? []).some(x => x.status === "ativa"));

  // Cada item: ok / atenção / parado, com a explicação e o que fazer.
  const checks: { ok: boolean; title: string; detail: string }[] = [
    { ok: c.bridge_connected !== false, title: "WhatsApp conectado", detail: c.bridge_connected === false ? "A ponte está desconectada. No PC, feche o iniciar-tudo e abra de novo; se pedir QR code, leia com o celular." : "A ponte do WhatsApp está no ar." },
    { ok: robotAlive, title: "Robô de envio ligado no PC", detail: robotAlive ? `Respondeu há ${Math.round(senderAge)}s.` : "O robô de envio não responde há mais de 2 minutos. No PC, abra o iniciar-tudo." },
    { ok: c.enabled && c.channel_authorized, title: "Hermes e canal autorizados", detail: c.enabled && c.channel_authorized ? "Liberado." : "Ligue o Hermes comercial e confirme o canal em Configurações." },
    { ok: o.enabled && !paused, title: "Envio ligado (sem pausa)", detail: o.enabled && !paused ? "Sem pausa." : "O envio está pausado. Use o botão Retomar envio aqui em cima." },
    { ok: inWindow, title: "Dentro do horário de envio", detail: inWindow ? `Agora é ${hour}h; janela das ${o.window_start}h às ${o.window_end}h.` : `Fora do horário: só envia ${o.window_start}h–${o.window_end}h (${(o.send_days as number[]).map(d => DAYS[d]).join(", ")}). Ajuste em Disparar → Configurações de envio.` },
    { ok: !limitReached, title: `Limite de hoje (${used} de ${target})`, detail: limitReached ? `O limite de hoje foi atingido${unconfirmed ? `, e ${unconfirmed} dessas vagas estão presas em mensagens sem confirmação` : ""}. Resolva as mensagens sem confirmação ou libere mais envios abaixo.` : `Ainda cabem ${target - used} envios hoje.` },
    { ok: stuck.length === 0, title: "Nenhuma mensagem travada", detail: stuck.length === 0 ? "Tudo resolvido." : `${stuck.length} mensagem(ns) esperando uma decisão sua mais abaixo.` },
    { ok: !c.test_mode, title: "Modo teste desligado", detail: c.test_mode ? "Só os telefones de teste recebem. Desligue em Hermes comercial." : "Envia para os leads reais." },
  ];
  const blocking = checks.find(x => !x.ok);
  const headline = blocking
    ? { tone: "border-rose-500/40 bg-rose-500/10", icon: "⛔", text: `Não está enviando agora: ${blocking.title.toLowerCase()}.`, hint: blocking.detail }
    : waiting === 0
      ? { tone: "border-amber-500/40 bg-amber-500/10", icon: "💤", text: "Tudo certo, mas não tem ninguém na fila.", hint: "Escolha leads e dispare em Disparar." }
      : { tone: "border-emerald-500/40 bg-emerald-500/10", icon: "✅", text: `Enviando normalmente. ${waiting} na fila.`, hint: o.next_send_at && new Date(o.next_send_at) > now ? `Próxima mensagem às ${fmtDateTime(o.next_send_at)}.` : "A próxima mensagem sai a qualquer momento (cada envio espera de 3 a 5 minutos para não parecer robô)." };

  return <>
    <PageHeader title="🎛️ Central de envio" subtitle="Veja o que está acontecendo com os disparos, resolva o que travou e mande pausar ou retomar. Atualiza sozinha." actions={<Link href="/disparo" className="btn-ghost">📤 Escolher leads e disparar</Link>} />

    <section className={`mb-5 rounded-3xl border p-5 ${headline.tone}`}>
      <p className="text-lg font-semibold">{headline.icon} {headline.text}</p>
      <p className="mt-1 text-sm text-slate-300">{headline.hint}</p>
      <div className="mt-4 flex flex-wrap items-start gap-3">
        <ActionForm action={resumeSending} submit="▶ Retomar envio" className="space-y-0" />
        <ActionForm action={pauseSending} submit="⏸ Pausar tudo" variant="btn-danger" className="space-y-0" confirmText="Pausa todos os disparos? Nada novo sai até você retomar." />
        <ActionForm action={setTodayTarget} submit="Liberar" variant="btn-ghost" className="space-y-0">
          <label className="mr-2 text-sm text-slate-300">Enviar hoje até <input name="today" type="number" min={1} max={500} defaultValue={Math.max(target, used + 10)} className="input !w-24 !py-1.5" /> contatos</label>
        </ActionForm>
      </div>
    </section>

    <section className="card mb-5 p-5">
      <h2 className="mb-3 font-semibold">Verificação do sistema</h2>
      <ul className="grid gap-2 md:grid-cols-2">
        {checks.map(x => <li key={x.title} className={`flex gap-3 rounded-2xl border p-3 text-sm ${x.ok ? "border-line/60" : "border-rose-500/40 bg-rose-500/5"}`}>
          <span aria-hidden className="text-lg">{x.ok ? "✅" : "❌"}</span>
          <span><b className="block">{x.title}</b><span className="text-muted">{x.detail}</span></span>
        </li>)}
      </ul>
    </section>

    <section className="card mb-5 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">⚠️ Mensagens que travaram <span className="badge bg-amber-500/15 text-amber-300">{stuck.length}</span></h2>
        {stuck.length > 0 && <div className="flex flex-wrap gap-2">
          <Bulk scope="unknown" action="retry" label="🔁 Reenviar todas" variant="btn-primary" confirm="Reenviar todas as mensagens sem confirmação? Faça isso só se conferiu no WhatsApp que elas NÃO saíram." />
          <Bulk scope="unknown" action="cancel" label="Cancelar todas" variant="btn-danger" confirm="Cancelar todas as mensagens travadas e tirar esses leads do disparo?" />
        </div>}
      </div>
      {stuck.length === 0 ? <Empty title="Nada travado 🎉" /> : <>
        <p className="mb-3 text-sm text-muted">O WhatsApp não confirmou essas mensagens. <b>Reenviar</b> coloca de novo na fila. <b>Já saiu</b> marca como enviada (use se você viu a mensagem no WhatsApp). <b>Cancelar</b> desiste desse lead.</p>
        <ul className="divide-y divide-line/60 text-sm">
          {stuck.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0"><b>{nameOf(r)}</b> <span className="text-muted">· {r.phone_e164} · {fmtDateTime(r.claimed_at ?? r.created_at)}</span><p className="text-xs text-amber-300">{why(r)}</p></div>
            <div className="flex flex-wrap gap-2"><Btn action="retry" id={r.id} label="🔁 Reenviar" variant="btn-primary" /><Btn action="sent" id={r.id} label="✓ Já saiu" variant="btn-ghost" confirm="Você conferiu no WhatsApp que essa mensagem foi enviada?" /><Btn action="cancel" id={r.id} label="Cancelar" variant="btn-danger" confirm="Cancelar e tirar esse lead do disparo?" /></div>
          </li>)}
        </ul></>}
    </section>

    <section className="card mb-5 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">📬 Fila de envio <span className="badge bg-sky-500/15 text-sky-300">{waiting}</span></h2>
        {waiting > 0 && <Bulk scope="queue" action="cancel" label="Esvaziar a fila" variant="btn-danger" confirm={`Cancelar as ${waiting} mensagens da fila e tirar esses leads do disparo?`} />}
      </div>
      {next.length === 0 ? <p className="text-sm text-muted">Fila vazia.</p> : <>
        <p className="mb-2 text-xs text-muted">Próximas {next.length} de {waiting}, na ordem em que saem.</p>
        <ul className="divide-y divide-line/60 text-sm">
          {next.map((r, i) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span><span className="mr-2 text-muted">{i + 1}.</span><b>{nameOf(r)}</b> <span className="text-muted">· {r.phone_e164}</span></span>
            <Btn action="cancel" id={r.id} label="Tirar da fila" variant="btn-ghost" confirm="Tirar esse lead da fila e do disparo?" />
          </li>)}
        </ul></>}
    </section>

    <section className="card p-5">
      <h2 className="mb-3 font-semibold">✅ Últimas enviadas</h2>
      {(sentRecent.data ?? []).length === 0 ? <p className="text-sm text-muted">Nada enviado ainda.</p> : <ul className="divide-y divide-line/60 text-sm">
        {((sentRecent.data ?? []) as unknown as Row[]).map(r => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2"><span><b>{nameOf(r)}</b> <span className="text-muted">· {r.phone_e164}</span></span><span className="text-muted">{r.status === "entregue" ? "entregue" : "enviada"} · {fmtDateTime(r.sent_at)}</span></li>)}
      </ul>}
    </section>
  </>;
}
