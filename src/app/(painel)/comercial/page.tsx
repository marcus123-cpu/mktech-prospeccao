import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PageHeader, ErrorBox } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { STAGES, ROLES } from "@/lib/commercial/engine";
import { COMMERCIAL_STAGE_LABEL, COMMERCIAL_ROLE_LABEL } from "@/lib/commercial/labels";
import { fmtDateTime, fmtMoney } from "@/lib/time";
import { saveCommercialSettings, pauseCommercial, pauseNewContacts, saveCommercialLead, addProduct, activateCommercial } from "./actions";
import { setConversationOwner } from "../conversas/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hermes comercial" };
const LABELS: Record<string,string> = { encontrados_hoje:"Encontrados hoje",qualificados_hoje:"Qualificados hoje",contatados_hoje:"Contatados hoje",respostas_humanas:"Respostas humanas hoje",respostas_automaticas:"Automáticas hoje",recepcionistas:"Recepcionistas",proprietarias:"Proprietárias",apresentacoes:"Apresentações autorizadas",videos:"Vídeos enviados",interessados:"Interessados",propostas_solicitadas:"Propostas solicitadas",propostas_enviadas:"Propostas enviadas",negociacoes:"Negociações",vendas:"Vendas fechadas",receita_confirmada:"Receita confirmada",sem_resposta:"Sem resposta",recusas:"Não contatar",envios_desconhecidos:"Envios a verificar" };
type Experiment = { strategy:string; contatos:number; respostas_humanas:number; decisores:number; apresentacoes:number; interesses:number; propostas:number; vendas:number };
type Funnel = { stage:string; total:number };

export default async function Commercial({ searchParams }: { searchParams: Promise<{ lead?:string; pagina?:string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Math.min(10000,Number.parseInt(sp.pagina ?? "1",10)||1));
  const { supabase } = await requireAdmin();
  const [settings, operation, report, leads, products, notifications, demos] = await Promise.all([
    supabase.from("commercial_settings").select("*").eq("id",1).single(),
    supabase.from("outreach_settings").select("enabled,paused").eq("id",1).single(),
    supabase.rpc("admin_commercial_metrics"),
    supabase.from("commercial_leads").select("*, leads!inner(business_name,city,secretary_handoff_at)",{ count:"exact" }).order("updated_at",{ascending:false}).order("lead_id").range((page-1)*30,page*30-1),
    supabase.from("commercial_products").select("*").order("name"),
    supabase.from("commercial_notifications").select("*").order("created_at",{ascending:false}).limit(20),
    supabase.from("commercial_demonstrations").select("*").order("id"),
  ]);
  if (settings.error || operation.error || report.error || leads.error || products.error || notifications.error) return <><PageHeader title="Hermes V4" /><ErrorBox message="Não foi possível carregar a operação V4. Confira a migração do banco." /></>;
  const s = settings.data;
  const active = s.enabled && s.channel_authorized && operation.data.enabled && !operation.data.paused;
  const selectedId = sp.lead && /^[0-9a-f-]{36}$/i.test(sp.lead) ? sp.lead : leads.data?.[0]?.lead_id;
  const [selected, outbox, decisions, events, demoHistory] = selectedId ? await Promise.all([
    supabase.from("commercial_leads").select("*,leads!inner(business_name,city,secretary_handoff_at,business_address,booking_url,phone_e164)").eq("lead_id",selectedId).maybeSingle(),
    supabase.from("commercial_outbox").select("*").eq("lead_id",selectedId).order("created_at",{ascending:false}).limit(30),
    supabase.from("commercial_decisions").select("*").eq("lead_id",selectedId).order("created_at",{ascending:false}).limit(20),
    supabase.from("commercial_events").select("*").eq("lead_id",selectedId).order("created_at",{ascending:false}).limit(30),
    supabase.from("lead_demonstrations").select("*").eq("lead_id",selectedId),
  ]) : [null,null,null,null,null];
  const current=selected?.data;
  const checked = (name:string, label:string, value:boolean) => <label className="flex items-center gap-2"><input type="checkbox" name={name} defaultChecked={value} />{label}</label>;
  const experiments = (report.data?.experiments ?? []) as Experiment[];
  const funnel = (report.data?.funnel ?? []) as Funnel[];
  return <>
    <AutoRefresh />
    <section className="card mb-4 p-4"><h2 className="font-semibold">Biblioteca de demonstrações</h2><ul className="mt-2 space-y-2 text-sm">{demos.data?.map(d=><li key={d.id}>{String(d.config.name)} · {d.config.kind==="video" ? "Vídeo" : "Site"} · {d.available ? "Acesso confirmado pelo enviador" : "Aguardando verificação do enviador"}{d.config.url && <> · <a href={String(d.config.url)} target="_blank" rel="noopener noreferrer" className="underline">Abrir demonstração</a></>}</li>)}</ul>{demoHistory?.data?.map(h=><p className="mt-2 text-sm" key={h.demonstration_id}>{h.demonstration_id} · recomendado {fmtDateTime(h.recommended_at)} · oferecido {h.offered_at ? fmtDateTime(h.offered_at) : "pendente"} · autorizado {h.authorized_at ? fmtDateTime(h.authorized_at) : "pendente"} · enviado {h.sent_at ? fmtDateTime(h.sent_at) : "pendente"}{h.client_response && ` · Resposta: ${h.client_response}`}</p>)}</section>
    <p className="mb-2 text-sm text-muted">WhatsApp: {s.bridge_connected===true ? "conectado" : s.bridge_connected===false ? "desconectado; envios suspensos" : "aguardando verificação"}</p>
    {!active && <div className="mb-4"><ActionForm action={activateCommercial} submit={s.test_mode ? "Ativar teste controlado" : "Ativar Hermes"} /></div>}
    <p className="mb-3 text-sm text-muted">Última conexão do Hermes: {s.last_worker_at ? fmtDateTime(s.last_worker_at) : "aguardando conexão"} · Última conexão do enviador: {s.last_sender_at ? fmtDateTime(s.last_sender_at) : "aguardando conexão"}</p>
    <PageHeader title={`Hermes Prospector ${s.engine_version==='v6'?'V6':'V4'}`} subtitle={`${active ? "Operação habilitada" : "Operação pausada ou aguardando configuração"} · ${s.test_mode ? "Contatos controlados" : "Produção"}`} actions={<><Link className="btn-ghost" href="/envio">Horários e limites</Link><Link className="btn-ghost" href="/configuracoes">Regiões e nichos</Link><ActionForm action={pauseNewContacts} submit={s.new_contacts_enabled ? 'Pausar novas abordagens' : 'Retomar novas abordagens'} variant="btn-ghost"><input type="hidden" name="enabled" value={String(!s.new_contacts_enabled)} /></ActionForm><ActionForm action={pauseCommercial} submit={operation.data.paused ? "Retomar operação" : "Pausar operação"} variant="btn-ghost"><input type="hidden" name="pause" value={String(!operation.data.paused)} /></ActionForm></>} />
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">{Object.entries(report.data.metrics as Record<string,number>).map(([k,v])=><div className="card p-3" key={k}><p className="text-xs text-muted">{LABELS[k] ?? k}</p><p className="mt-1 text-xl font-semibold">{k==="receita_confirmada" ? fmtMoney(v) : v}</p></div>)}</div>
    <section className="card my-4 p-4"><h2 className="font-semibold">Funil comercial</h2><div className="mt-3 flex flex-wrap gap-2">{STAGES.map(stage=><span className="badge bg-panel-2" key={stage}>{COMMERCIAL_STAGE_LABEL[stage]} · {funnel.find(f=>f.stage===stage)?.total ?? 0}</span>)}</div></section>
    <section className="card mb-4 overflow-x-auto p-4"><h2 className="font-semibold">Experimento A/B/C · 10 contatos por grupo</h2><p className="my-2 text-sm text-muted">Contagens por coorte de primeiros contatos enviados. Respostas automáticas não contam como humanas. A amostra inicial serve para observar; o sistema não declara vencedora nem muda a produção.</p><table className="w-full text-left text-sm"><thead><tr>{["Estratégia","Contatos","Resposta humana","Decisor","Apresentação","Interesse","Proposta","Venda"].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead><tbody>{experiments.map(e=><tr key={e.strategy}><td className="p-2">{e.strategy}</td><td>{e.contatos}</td>{[e.respostas_humanas,e.decisores,e.apresentacoes,e.interesses,e.propostas,e.vendas].map((v,i)=><td key={i}>{v} · {e.contatos ? Math.round(100*v/e.contatos) : 0}%</td>)}</tr>)}</tbody></table>{!experiments.length && <p className="text-sm text-muted">Nenhum contato experimental enviado.</p>}</section>
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <details className="card p-4"><summary className="cursor-pointer font-semibold">Configuração da operação</summary><ActionForm action={saveCommercialSettings} submit="Salvar configuração" className="mt-4 space-y-3">
        <label className="block">Motor de conversa<select className="input" name="engine_version" defaultValue={s.engine_version??'v4'}><option value="v4">V4</option><option value="v6">V6 contextual · teste controlado</option></select></label>
        {checked("enabled","Usar motor comercial",s.enabled)}{checked("new_contacts_enabled","Permitir novas abordagens",s.new_contacts_enabled??true)}{checked("channel_authorized","Canal autorizado para os contatos configurados",s.channel_authorized)}{checked("test_mode","Restringir aos telefones de teste",s.test_mode)}{checked("video_configured","Vídeo demonstrativo configurado na ponte",s.video_configured)}{checked("experiment_enabled","Experimento inicial balanceado A/B/C",s.experiment_enabled)}
        <div className="rounded-lg border border-line p-3"><p className="font-medium">Objeção inicial</p>{checked("objection_recovery_enabled","Uma apresentação breve após “não tenho interesse”",s.objection_recovery_enabled??true)}<p className="mt-1 text-xs text-muted">Uma tentativa por lead, baseada no diagnóstico, sem enviar material sem autorização. Pedido para parar encerra imediatamente.</p></div>
        <label className="block">Telefones de teste<textarea className="input" name="test_phones" defaultValue={s.test_phones.join("\n")} /></label>
        <label className="block">Máximo de mensagens por conversa<input className="input" type="number" name="max_messages" min={1} max={50} defaultValue={s.max_messages} /></label>
        <fieldset><legend>Estratégias permitidas</legend>{["A","B","C"].map(x=><label className="mr-4 inline-flex gap-2" key={x}><input type="checkbox" name="allowed_strategies" value={x} defaultChecked={s.allowed_strategies.includes(x)} />{x}</label>)}</fieldset>
      </ActionForm></details>
      <details className="card p-4"><summary className="cursor-pointer font-semibold">Tabela comercial oficial</summary><ul className="my-3 space-y-2 text-sm">{products.data.map(p=><li key={p.id}>{p.name} · {fmtMoney(p.price)} · {p.approved ? "Aprovado" : "Não aprovado"} · {p.conditions}</li>)}</ul><ActionForm action={addProduct} submit="Cadastrar produto">
        <label className="block">Nome<input name="name" className="input" required maxLength={100} /></label>
        <label className="block">Escopo<select name="scope" className="input"><option value="landing_page_whatsapp">Landing page e WhatsApp</option><option value="site_institucional">Site institucional</option><option value="agendamento">Agendamento</option></select></label>
        <label className="block">Preço oficial (R$)<input name="price" className="input" type="number" min="0.01" step="0.01" required /></label>
        <label className="block">Condições<textarea name="conditions" className="input" required maxLength={250} /></label>
        <label className="block">Prazo em dias (opcional)<input name="delivery_days" className="input" type="number" min={1} max={365} /></label>
        {checked("approved","Aprovar preço, escopo e condições para uso autônomo",false)}
      </ActionForm>
      {products.data.map(p=><details key={p.id} className="mt-4 border-t border-line pt-3"><summary>Editar {p.name}</summary><ActionForm action={addProduct} submit="Atualizar produto" className="mt-3 space-y-3">
        <input type="hidden" name="id" value={p.id} /><input type="hidden" name="name" value={p.name} /><input type="hidden" name="scope" value={p.scope} />
        <label className="block">Preço oficial (R$)<input name="price" className="input" type="number" min="0.01" step="0.01" required defaultValue={p.price} /></label>
        <label className="block">Condições<textarea name="conditions" className="input" required maxLength={250} defaultValue={p.conditions} /></label>
        <label className="block">Prazo em dias<input name="delivery_days" className="input" type="number" min={1} max={365} defaultValue={p.delivery_days ?? ""} /></label>
        {checked("approved","Aprovado para uso autônomo",p.approved)}
      </ActionForm></details>)}
      </details>
    </div>
    <div className="my-4 grid items-start gap-4 xl:grid-cols-[300px_1fr]">
      <aside className="card p-4"><h2 className="font-semibold">Leads · {leads.count ?? 0}</h2><ul className="my-3 space-y-3">{leads.data.map(l=><li key={l.lead_id}><Link href={`/comercial?lead=${l.lead_id}&pagina=${page}`} aria-current={selectedId===l.lead_id ? "page" : undefined} className="block"><strong>{l.leads.business_name}</strong><p className="text-xs text-muted">{l.leads.city} · {COMMERCIAL_STAGE_LABEL[l.stage as keyof typeof COMMERCIAL_STAGE_LABEL]} · {l.eligible ? "Elegível" : "Aguardando elegibilidade"}</p></Link></li>)}</ul><nav aria-label="Páginas de leads" className="flex justify-between">{page>1 && <Link href={`/comercial?pagina=${page-1}`}>Anterior</Link>}{page*30<(leads.count ?? 0) && <Link href={`/comercial?pagina=${page+1}`}>Próxima</Link>}</nav></aside>
      {selected?.error || outbox?.error || decisions?.error || events?.error ? <ErrorBox message="Falha ao carregar este lead." /> : current && <section className="card space-y-4 p-4"><h2 className="font-semibold">{current.leads.business_name}</h2><div className="flex flex-wrap gap-2"><Link className="btn-ghost" href={`/leads/${current.lead_id}`}>Ficha e fontes</Link><Link className="btn-ghost" href={`/conversas?lead=${current.lead_id}`}>Histórico da conversa</Link><ActionForm action={setConversationOwner} submit={current.leads.secretary_handoff_at ? "Devolver ao Hermes" : "Assumir conversa"} variant="btn-ghost"><input type="hidden" name="lead_id" value={current.lead_id} /><input type="hidden" name="owner" value={current.leads.secretary_handoff_at ? "secretario" : "marcos"} /></ActionForm></div>
        <p>Score: {current.score ?? "Pendente"}/100 · Confiança dos dados: {current.data_confidence ?? "Pendente"}% · Estratégia: {current.strategy ?? "Não alocada"}</p>
        {s.engine_version==='v6'&&<><p className="text-sm">Prontidão: {current.readiness?.status??'NEEDS_RESEARCH'} · Conversa: {current.conversation_phase} · Fuso: {current.recipient_timezone??'não confirmado'}</p><ul className="text-sm text-muted">{current.readiness?.reasons?.map((reason:string)=><li key={reason}>{reason}</li>)}</ul><details><summary>Memória comercial</summary><p className="mt-2 text-sm whitespace-pre-wrap">{current.commercial_memory?.summary||'Aguardando interpretação'}</p><p className="text-sm">Próxima ação: {current.commercial_memory?.next_action||'Aguardar'}</p><ul className="text-sm">{current.commercial_memory?.confirmed_facts?.map((fact:{key:string;value:string;evidence:string;source_id:string},index:number)=><li className="mt-2" key={index}>{fact.key}: {fact.value}<p className="text-muted">Evidência: {fact.evidence}</p></li>)}</ul></details></>}
        <p className="text-sm">{current.leads.phone_e164 ?? "Telefone não informado"}{current.leads.business_address ? ` · ${current.leads.business_address}` : ""}</p>
        {current.leads.booking_url && <p className="break-all text-sm text-muted">Agendamento: {current.leads.booking_url}</p>}
        <p className="text-sm">Vídeo: {current.video_sent_at ? `enviado em ${fmtDateTime(current.video_sent_at)}` : current.video_authorized ? "autorizado" : "não autorizado"} · Próximo retorno: {current.followup_at ? fmtDateTime(current.followup_at) : "não combinado"}</p>
        <p className="text-sm text-muted">Interlocutor: {COMMERCIAL_ROLE_LABEL[current.role as keyof typeof COMMERCIAL_ROLE_LABEL]} · {Math.round(current.role_confidence*100)}% · {current.role_evidence || "Sem evidência"}</p>
        <dl className="text-sm">{Object.entries(current.facts as Record<string,string>).map(([k,v])=><div key={k}><dt className="inline text-muted">{k.replaceAll("_"," ")}: </dt><dd className="inline">{v}</dd></div>)}</dl>
        <ul className="text-sm text-muted">{(current.score_details?.reasons ?? []).map((r:string)=><li key={r}>{r}</li>)}</ul>
        <ActionForm action={saveCommercialLead} submit="Salvar lead e corrigir classificação"><input type="hidden" name="lead_id" value={current.lead_id} />
          {checked("eligible","Contato elegível para este canal",current.eligible)}<label className="block">Base de elegibilidade e autorização<textarea className="input" name="eligibility_reason" maxLength={1000} defaultValue={current.eligibility_reason} /></label>
          <label className="block">Etapa<select name="stage" className="input" defaultValue={current.stage}>{STAGES.map(x=><option key={x} value={x}>{COMMERCIAL_STAGE_LABEL[x]}</option>)}</select></label>
          <label className="block">Interlocutor<select name="role" className="input" defaultValue={current.role}>{ROLES.map(x=><option key={x} value={x}>{COMMERCIAL_ROLE_LABEL[x]}</option>)}</select></label>
          <label className="block">Evidência da identificação<textarea name="role_evidence" className="input" maxLength={1000} defaultValue={current.role_evidence} /></label>
        </ActionForm>
        <details><summary>Fila e resultados de envio</summary><ul className="mt-3 space-y-3">{outbox?.data?.map(b=><li key={b.id}><p className="text-xs text-muted">{b.kind} · {b.status} · {fmtDateTime(b.created_at)}</p><p className="text-sm whitespace-pre-wrap">{b.body}</p>{b.error && <p className="text-sm text-amber-300">{b.error}</p>}</li>)}</ul></details>
        <details><summary>Decisões do Hermes</summary><ul className="mt-3 space-y-2 text-sm">{decisions?.data?.map(d=><li key={d.id}>{fmtDateTime(d.created_at)} · {d.intent} · {d.action}<p className="text-muted">{d.reason}</p></li>)}</ul></details>
        <details><summary>Histórico das etapas</summary><ul className="mt-3 space-y-2 text-sm">{events?.data?.map(e=><li key={e.id}>{COMMERCIAL_STAGE_LABEL[e.to_stage as keyof typeof COMMERCIAL_STAGE_LABEL]} · {fmtDateTime(e.created_at)} · {e.reason}</li>)}</ul></details>
      </section>}
    </div>
    <section className="card p-4"><h2 className="font-semibold">Notificações recentes</h2><ul className="mt-3 space-y-2">{notifications.data.map(n=><li className="text-sm" key={n.id}>{n.lead_id ? <Link href={`/comercial?lead=${n.lead_id}`}>{n.title}</Link> : n.title}<span className="ml-2 text-xs text-muted">{fmtDateTime(n.created_at)}</span><p className="text-muted">{n.detail}</p></li>)}</ul></section>
  </>;
}

