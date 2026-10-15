import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Empty, ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { fmtDateTime } from "@/lib/time";
import { addCampaignEligible, addCampaignLeads, addCampaignList, campaignAction, createCampaign, pauseEverything, removeCampaignLead, setCampaignMode, simulateReply } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campanhas e Disparos" };

const STATUS: Record<string, string> = { rascunho: "Rascunho", ativa: "Ativa", pausada: "Pausada", encerrada: "Encerrada" };
const MODE: Record<string, string> = { simulacao: "Simulação (sem envio real)", autonomo: "Autônomo (envia sozinho)" };
const EVENT: Record<string, string> = {
  criada: "Campanha criada", lead_adicionado: "Lead selecionado", lead_removido: "Lead removido", acao_activate: "Campanha ativada", acao_pause: "Campanha pausada",
  acao_resume: "Campanha retomada", acao_end: "Campanha encerrada", pausa_geral: "Pausa imediata", modo_alterado: "Modo alterado", decisao: "Decisão do Hermes",
  decisao_simulada: "Decisão simulada", resposta_simulada: "Resposta simulada do cliente", bloqueio_registrado: "Pedido de não contato registrado",
  bloqueio_simulado: "Bloqueio simulado", intervencao_humana: "Intervenção humana necessária", aviso_equipe: "Aviso à equipe",
};
const SOURCE: Record<string, string> = { simulacao: "Hermes (simulado)", hermes_v4: "Hermes", humana: "Cliente", automatica: "Resposta automática", saudacao: "Saudação" };
type Campaign = { id: string; name: string; notes: string | null; mode: string; status: string; created_at: string; activated_at: string | null };
type Member = { lead_id: string; leads: { business_name: string; city: string; contacted: boolean; do_not_contact: boolean; secretary_handoff_at: string | null } | null; commercial: { stage: string; conversation_phase: string } | null };
type LogRow = { id: number; lead_id: string | null; event: string; detail: Record<string, unknown>; created_at: string };
type Timeline = { id: string; lead_id: string; occurred_at: string; direction: string; source: string; body: string | null };

export default async function CampanhasPage({ searchParams }: { searchParams: Promise<{ campanha?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const lists = await supabase.from("lead_lists").select("id,name,lead_list_items(count)").order("name");
  const list = await supabase.from("commercial_campaigns").select("*").order("created_at", { ascending: false }).limit(50);
  if (list.error) return <><PageHeader title="Campanhas" /><ErrorBox message="Não foi possível carregar as campanhas. Aplique a migração 20261014160000_campanhas_autonomas.sql." /></>;
  const campaigns = (list.data ?? []) as Campaign[];
  const current = campaigns.find((c) => c.id === sp.campanha) ?? campaigns.find((c) => c.status === "ativa") ?? campaigns[0];

  type Stats = { recipients: number; prepared: number; sending: number; sent: number; delivered: number; simulated: number; replies: number; failures: number; cancelled: number; blocked: number; contacted: number };
  let stats: Stats | null = null;
  let members: Member[] = []; let log: LogRow[] = []; let timeline: Timeline[] = []; let candidates: { id: string; business_name: string; city: string; fit_score: number | null }[] = [];
  if (current) {
    const st = await supabase.rpc("admin_campaign_stats", { p_campaign: current.id });
    stats = st.error ? null : (st.data as Stats);
    const [m, l, cand] = await Promise.all([
      supabase.from("commercial_campaign_leads").select("lead_id,leads!inner(business_name,city,contacted,do_not_contact,secretary_handoff_at)").eq("campaign_id", current.id).order("added_at"),
      supabase.from("commercial_campaign_log").select("id,lead_id,event,detail,created_at").eq("campaign_id", current.id).order("id", { ascending: false }).limit(60),
      current.status === "encerrada" ? Promise.resolve({ data: [] }) : supabase.from("leads").select("id,business_name,city,fit_score,commercial_campaign_leads(lead_id)")
        .eq("stage", "novo").eq("contacted", false).eq("do_not_contact", false).not("phone_e164", "is", null).order("fit_score", { ascending: false, nullsFirst: false }).limit(150),
    ]);
    const base = (m.data ?? []) as unknown as Omit<Member, "commercial">[];
    const ids = base.map((x) => x.lead_id);
    const [states, tl] = ids.length ? await Promise.all([
      supabase.from("commercial_leads").select("lead_id,stage,conversation_phase").in("lead_id", ids),
      supabase.from("conversation_timeline").select("id,lead_id,occurred_at,direction,source,body").in("lead_id", ids).order("occurred_at"),
    ]) : [{ data: [] }, { data: [] }];
    const byLead = new Map((states.data ?? []).map((s) => [s.lead_id, s]));
    members = base.map((x) => ({ ...x, commercial: byLead.get(x.lead_id) ?? null }));
    log = (l.data ?? []) as LogRow[];
    timeline = (tl.data ?? []) as Timeline[];
    candidates = ((cand.data ?? []) as unknown as { id: string; business_name: string; city: string; fit_score: number | null; commercial_campaign_leads: unknown[] }[])
      .filter((c) => !c.commercial_campaign_leads?.length);
  }
  const name = new Map(members.map((x) => [x.lead_id, x.leads?.business_name ?? "Lead"]));
  const hidden = (c: Campaign, action: string) => <><input type="hidden" name="campaign_id" value={c.id} /><input type="hidden" name="action" value={action} /></>;

  return <>
    <AutoRefresh />
    <PageHeader title="📣 Campanhas e Disparos" subtitle="Você escolhe a lista ou os leads e liga a campanha; nada é enviado só porque uma pesquisa terminou. Depois de ativada, o Hermes conduz as conversas sozinho, dentro dos limites e horários configurados." />
    <section className="card mb-4 border border-rose-500/40 p-4">
      <h2 className="font-semibold">Pausa imediata</h2>
      <p className="mb-3 text-sm text-muted">Pausa todas as campanhas ativas e o envio global. Mensagens já na fila ficam retidas.</p>
      <ActionForm action={pauseEverything} submit="Pausar tudo agora" variant="btn-danger" confirmText="Pausar todas as campanhas e o envio?" />
    </section>

    <section className="card mb-4 p-4">
      <h2 className="font-semibold">Nova campanha</h2>
      <ActionForm action={createCampaign} submit="Criar campanha" className="mt-2 grid gap-3 sm:grid-cols-2">
        <input name="name" required maxLength={80} placeholder="Nome (ex.: Estética Votuporanga)" className="input" />
        <input name="notes" maxLength={500} placeholder="Observações (opcional)" className="input" />
      </ActionForm>
    </section>

    {campaigns.length === 0 ? <Empty title="Nenhuma campanha ainda">Crie uma campanha, selecione os leads e teste em simulação antes de liberar o modo autônomo.</Empty> : <>
      <nav className="mb-4 flex flex-wrap gap-2">
        {campaigns.map((c) => <Link key={c.id} href={`/campanhas?campanha=${c.id}`} className={`rounded-full border px-3 py-1 text-sm ${c.id === current?.id ? "border-violet-400 bg-violet-500/20" : "border-white/10"}`}>{c.name} · {STATUS[c.status]}</Link>)}
      </nav>
      {current && <>
        <section className="card mb-4 p-4">
          <h2 className="font-semibold">{current.name}</h2>
          {current.notes && <p className="text-sm text-muted">{current.notes}</p>}
          <p className="mt-1 text-sm">Estado: <b>{STATUS[current.status]}</b> · Modo: <b>{MODE[current.mode]}</b> · {members.length} lead(s) · criada {fmtDateTime(current.created_at)}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {current.status === "rascunho" && <ActionForm action={campaignAction} submit={current.mode === "autonomo" ? "Ativar em modo autônomo" : "Ativar simulação"} className="space-y-0" confirmText={current.mode === "autonomo" ? "O Hermes passará a enviar mensagens reais aos leads selecionados, sem aprovação individual. Ativar?" : undefined}>{hidden(current, "activate")}</ActionForm>}
            {current.status === "pausada" && <ActionForm action={campaignAction} submit="Retomar" className="space-y-0" confirmText={current.mode === "autonomo" ? "Retomar o envio real?" : undefined}>{hidden(current, "resume")}</ActionForm>}
            {current.status === "ativa" && <ActionForm action={campaignAction} submit="Pausar" variant="btn-ghost" className="space-y-0">{hidden(current, "pause")}</ActionForm>}
            {current.status !== "encerrada" && <ActionForm action={campaignAction} submit="Cancelar campanha" variant="btn-danger" className="space-y-0" confirmText="Cancelar a campanha apaga as mensagens ainda na fila e não pode ser desfeito. Continuar?">{hidden(current, "end")}</ActionForm>}
            {(current.status === "rascunho" || current.status === "pausada") && <ActionForm action={setCampaignMode} submit={current.mode === "simulacao" ? "Liberar modo autônomo" : "Voltar para simulação"} variant="btn-ghost" className="space-y-0" confirmText={current.mode === "simulacao" ? "Libera o envio real e apaga as conversas simuladas desta campanha. Exige simulação concluída. Continuar?" : undefined}>
              <input type="hidden" name="campaign_id" value={current.id} /><input type="hidden" name="mode" value={current.mode === "simulacao" ? "autonomo" : "simulacao"} />
            </ActionForm>}
          </div>
          {current.mode === "simulacao" && current.status !== "encerrada" && <p className="mt-3 text-sm text-muted">Na simulação nada é enviado. Ative, aguarde a saudação do Hermes e use “Responder como cliente” para testar preço, recusa, interesse e pedido de atendimento humano. Antes de liberar o modo autônomo, o sistema exige a saudação e ao menos uma resposta simuladas.</p>}
        </section>

        {stats && <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {([["Destinatários", stats.recipients], ["Preparadas", stats.prepared], ["Enviadas", stats.sent], ["Entregues", stats.delivered], ["Respostas", stats.replies], ["Falhas", stats.failures], ["Bloqueios", stats.blocked], ["Simuladas", stats.simulated]] as const).map(([label, v]) =>
            <div key={label} className="card p-2 text-center"><p className="text-xl font-semibold">{v}</p><p className="text-xs text-muted">{label}</p></div>)}
        </section>}

        <section className="card mb-4 p-4">
          <h2 className="font-semibold">Leads da campanha</h2>
          {members.length === 0 ? <p className="text-sm text-muted">Nenhum lead selecionado.</p> : <ul className="mt-2 divide-y divide-white/10">
            {members.map((m) => {
              const events = timeline.filter((t) => t.lead_id === m.lead_id);
              return <li key={m.lead_id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><b>{m.leads?.business_name}</b> <span className="text-sm text-muted">{m.leads?.city} · {m.commercial?.stage ?? "—"} · {m.commercial?.conversation_phase ?? "—"}{m.leads?.do_not_contact ? " · NÃO CONTATAR" : ""}{m.leads?.secretary_handoff_at ? " · com você" : ""}</span></div>
                  {current.status !== "encerrada" && !m.leads?.contacted && <ActionForm action={removeCampaignLead} submit="Remover" variant="btn-ghost" className="space-y-0"><input type="hidden" name="lead_id" value={m.lead_id} /></ActionForm>}
                </div>
                {events.length > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer">Conversa ({events.length})</summary>
                  <ul className="mt-2 space-y-1">{events.map((e) => <li key={e.id} className={e.direction === "saida" ? "text-violet-200" : ""}><span className="text-xs text-muted">{fmtDateTime(e.occurred_at)} · {SOURCE[e.source] ?? e.source}</span><br />{e.body}</li>)}</ul></details>}
                {current.mode === "simulacao" && current.status === "ativa" && <ActionForm action={simulateReply} submit="Responder como cliente" variant="btn-ghost" className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="lead_id" value={m.lead_id} /><input name="body" required maxLength={1000} placeholder='Ex.: "Quanto custa?" ou "Não quero receber mensagens"' className="input min-w-64 flex-1" />
                </ActionForm>}
              </li>;
            })}
          </ul>}
        </section>

        {current.status !== "encerrada" && <section className="card mb-4 p-4">
          <h2 className="font-semibold">Selecionar leads</h2>
          <p className="mb-2 text-sm text-muted">Só aparecem leads novos, nunca contatados, com telefone e sem pedido de não contato. O sistema recusa os que não têm pesquisa suficiente ou telefone repetido.</p>
          <div className="mb-3 flex flex-wrap items-start gap-3">
            <ActionForm action={addCampaignList} submit="Adicionar lista inteira" variant="btn-ghost" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="campaign_id" value={current.id} />
              <select name="list_id" required defaultValue="" className="input"><option value="" disabled>Escolha uma lista…</option>{(lists.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name} ({(l.lead_list_items as unknown as { count: number }[])?.[0]?.count ?? 0})</option>)}</select>
            </ActionForm>
            <ActionForm action={addCampaignEligible} submit="Adicionar todos os elegíveis" variant="btn-ghost" className="space-y-0" confirmText="Adiciona todos os leads novos, com telefone e pesquisa suficiente, que não estão em outra campanha. Continuar?"><input type="hidden" name="campaign_id" value={current.id} /></ActionForm>
          </div>
          {candidates.length === 0 ? <p className="text-sm text-muted">Nenhum lead disponível.</p> :
            <ActionForm action={addCampaignLeads} submit="Adicionar selecionados">
              <input type="hidden" name="campaign_id" value={current.id} />
              <ul className="max-h-80 overflow-auto rounded border border-white/10 p-2 text-sm">{candidates.map((c) => <li key={c.id}><label className="flex items-center gap-2 py-0.5"><input type="checkbox" name="lead_ids" value={c.id} />{c.business_name} <span className="text-muted">· {c.city} · nota {c.fit_score ?? "—"}</span></label></li>)}</ul>
            </ActionForm>}
        </section>}

        <section className="card mb-4 p-4">
          <h2 className="font-semibold">Registro completo</h2>
          {log.length === 0 ? <p className="text-sm text-muted">Sem eventos.</p> : <ul className="mt-2 space-y-1 text-sm">{log.map((e) => {
            const d = e.detail as { body?: string; reason?: string; action?: string; notification?: string };
            return <li key={e.id}><span className="text-xs text-muted">{fmtDateTime(e.created_at)}</span> · <b>{EVENT[e.event] ?? e.event}</b>{e.lead_id && name.get(e.lead_id) ? ` · ${name.get(e.lead_id)}` : ""}{d.action ? ` · ${d.action}` : ""}{d.body ? ` — “${d.body}”` : ""}{d.reason ? ` (${d.reason})` : ""}</li>;
          })}</ul>}
        </section>
      </>}
    </>}
  </>;
}
