import { ActionForm } from "@/components/ActionForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CheckAll } from "@/components/CheckAll";
import { ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { UFS } from "@/lib/research";
import { fmtDateTime } from "@/lib/time";
import { dispatchAction, startDispatch, stopAll } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disparar" };

type Sp = { q?: string; city?: string; state?: string; niche?: string };
type Stats = { recipients: number; prepared: number; sent: number; delivered: number; replies: number; failures: number; blocked: number };
type Membership = { commercial_campaigns: { status: string } | null }; // o banco devolve 1 objeto (lead_id é chave única)
const DAYS = ["", "seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const clean = (s?: string) => (s ?? "").replace(/[%,()*]/g, " ").trim();

export default async function DisparoPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [commercial, outreach, available, dispatches] = await Promise.all([
    supabase.from("commercial_settings").select("enabled,channel_authorized,engine_version,bridge_connected,test_mode").eq("id", 1).single(),
    supabase.from("outreach_settings").select("enabled,paused,window_start,window_end,send_days,today_new_leads_target,today_new_leads_date").eq("id", 1).single(),
    supabase.rpc("admin_dispatch_available_count"),
    supabase.from("commercial_campaigns").select("id,name,status,bot_replies,created_at").eq("mode", "autonomo").order("created_at", { ascending: false }).limit(6),
  ]);
  if (commercial.error || outreach.error || available.error) return <><PageHeader title="Disparar" /><ErrorBox message="Não foi possível carregar. Aplique as migrações 20261014160000 até 20261015120000 no Supabase." /></>;
  const c = commercial.data, o = outreach.data;

  let query = supabase.from("leads").select("id,business_name,city,state,niche,fit_score,commercial_campaign_leads(lead_id,commercial_campaigns(status))")
    .eq("stage", "novo").eq("contacted", false).eq("do_not_contact", false).like("phone_e164", "+55__9________")
    .order("fit_score", { ascending: false, nullsFirst: false }).limit(300);
  const q = clean(sp.q); if (q) query = query.or(`business_name.ilike.%${q}%,city.ilike.%${q}%`);
  const city = clean(sp.city); if (city) query = query.ilike("city", `%${city}%`);
  const niche = clean(sp.niche); if (niche) query = query.ilike("niche", `%${niche}%`);
  if (sp.state && /^[A-Za-z]{2}$/.test(sp.state)) query = query.eq("state", sp.state.toUpperCase());
  const rows = await query;
  const candidates = ((rows.data ?? []) as unknown as { id: string; business_name: string; city: string; state: string | null; niche: string | null; fit_score: number | null; commercial_campaign_leads: Membership | Membership[] | null }[])
    .filter((l) => ![l.commercial_campaign_leads ?? []].flat().some((m) => m.commercial_campaigns?.status !== "encerrada"));

  const stats = new Map<string, Stats>();
  for (const d of dispatches.data ?? []) {
    const r = await supabase.rpc("admin_campaign_stats", { p_campaign: d.id });
    if (!r.error) stats.set(d.id, r.data as Stats);
  }
  const problems: string[] = [];
  if (c.engine_version !== "v6") problems.push("O motor V6 não está ativo.");
  if (!c.enabled || !c.channel_authorized) problems.push("O Hermes está desligado: ative em “Hermes comercial” e confirme o canal.");
  if (!o.enabled) problems.push("A chave de envio está desligada na Central de disparos.");
  if (o.paused) problems.push("O envio está pausado. Ao iniciar um disparo ele volta a funcionar.");
  if (c.test_mode) problems.push("O modo teste está ligado: só os telefones de teste recebem. Desligue em “Hermes comercial”.");
  if (c.bridge_connected === false) problems.push("O WhatsApp está desconectado: abra a ponte no PC.");
  const days = (o.send_days as number[]).map((d) => DAYS[d]).join(", ");
  const todayTarget = o.today_new_leads_date ? o.today_new_leads_target : null;

  return <>
    <AutoRefresh />
    <PageHeader title="📤 Disparar" subtitle="Escolha quem recebe e dispare. O Hermes manda só a saudação, aos poucos, respeitando horário, limite e quem pediu para não receber. A conversa depois é toda sua." />

    {problems.length > 0 && <div className="mb-4 rounded border border-amber-500/40 p-3 text-sm text-amber-300">{problems.map((p) => <p key={p}>⚠️ {p}</p>)}</div>}
    <p className="mb-4 text-sm text-muted">Horário de envio: {days}, das {o.window_start}h às {o.window_end}h (ajuste na Central de disparos). {todayTarget != null ? `Limite de hoje: ${todayTarget} novos contatos.` : ""}</p>

    <form method="get" className="card mb-4 grid gap-2 p-3 sm:grid-cols-5">
      <input name="q" defaultValue={sp.q} placeholder="Buscar nome ou cidade" className="input" />
      <input name="niche" defaultValue={sp.niche} placeholder="Nicho" className="input" />
      <input name="city" defaultValue={sp.city} placeholder="Cidade" className="input" />
      <select name="state" defaultValue={sp.state ?? ""} className="input"><option value="">Estado</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
      <button className="btn-ghost">Filtrar a lista</button>
    </form>

    <ActionForm action={startDispatch} submit="🚀 Disparar agora" className="space-y-4"
      confirmText="O Hermes vai começar a enviar a saudação real no WhatsApp para os leads escolhidos. Disparar?">
      <section className="card p-4">
        <h2 className="mb-2 font-semibold">1. Quem recebe a saudação</h2>
        <label className="mb-1 flex items-center gap-2 text-sm"><input type="radio" name="scope" value="selected" defaultChecked /> Os que eu marcar na lista abaixo</label>

        <label className="mb-3 flex items-center gap-2 text-sm"><input type="radio" name="scope" value="all" /> Todos os leads novos disponíveis ({available.data})</label>
        <p className="mb-2 text-xs text-muted">Só aparecem leads novos, com celular, nunca contatados e fora de outro disparo. Telefone fixo, já contatado e quem pediu para não receber ficam de fora automaticamente.</p>
        {candidates.length === 0 ? <p className="text-sm text-muted">Nenhum lead disponível com esses filtros.</p> : <>
          <label className="mb-1 flex items-center gap-2 text-sm"><CheckAll name="lead_ids" /> Marcar todos desta lista ({candidates.length})</label>
          <ul className="max-h-80 overflow-auto rounded border border-white/10 p-2 text-sm">
            {candidates.map((l) => <li key={l.id}><label className="flex items-center gap-2 py-0.5"><input type="checkbox" name="lead_ids" value={l.id} />{l.business_name} <span className="text-muted">· {l.city}{l.state ? `/${l.state}` : ""} · nota {l.fit_score ?? "—"}</span></label></li>)}
          </ul></>}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">2. Quantas saudações enviar hoje</h2>
        <input name="today" type="number" min={1} max={200} defaultValue={20} className="input w-28" />
        <span className="ml-2 text-xs text-muted">Os envios saem espaçados, no horário acima. O que sobrar continua amanhã se você repetir o disparo.</span>
      </section>
    </ActionForm>

    <section className="card mt-6 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Disparos feitos</h2>
        <ActionForm action={stopAll} submit="⛔ Pausar tudo agora" variant="btn-danger" className="space-y-0" confirmText="Pausa todos os disparos e o envio global?" />
      </div>
      {(dispatches.data ?? []).length === 0 ? <p className="text-sm text-muted">Nenhum disparo ainda.</p> : <ul className="divide-y divide-white/10 text-sm">
        {(dispatches.data ?? []).map((d) => {
          const s = stats.get(d.id);
          const hidden = (action: string) => <><input type="hidden" name="campaign_id" value={d.id} /><input type="hidden" name="action" value={action} /></>;
          return <li key={d.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span><b>{d.name}</b> · {d.status === "ativa" ? "enviando" : d.status} · só saudação <span className="text-xs text-muted">· {fmtDateTime(d.created_at)}</span></span>
              <span className="flex gap-2">
                {d.status === "ativa" && <ActionForm action={dispatchAction} submit="Pausar" variant="btn-ghost" className="space-y-0">{hidden("pause")}</ActionForm>}
                {d.status === "pausada" && <ActionForm action={dispatchAction} submit="Retomar" variant="btn-ghost" className="space-y-0">{hidden("resume")}</ActionForm>}
                {d.status !== "encerrada" && <ActionForm action={dispatchAction} submit="Cancelar" variant="btn-danger" className="space-y-0" confirmText="Cancelar apaga as mensagens ainda na fila. Continuar?">{hidden("end")}</ActionForm>}
              </span>
            </div>
            {s && <p className="mt-1 text-xs text-muted">{s.recipients} destinatários · {s.prepared} na fila · <b className="text-text">{s.sent} enviadas</b> · {s.delivered} entregues · {s.replies} respostas · {s.failures} falhas · {s.blocked} bloqueios</p>}
          </li>;
        })}
      </ul>}
    </section>
  </>;
}
