import Link from "next/link";
import { ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { fmtDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saúde do sistema" };

type Outbox = { id: string; lead_id: string; status: string; provider_id: string | null; due_at: string; sent_at: string | null; delivered_at: string | null; error: string | null; created_at: string; leads: { business_name: string } | { business_name: string }[] | null };
const recent = (value: string | null | undefined, minutes: number) => !!value && Date.now() - new Date(value).getTime() < minutes * 60_000;
const date = (value: string | null | undefined) => value ? fmtDateTime(value) : "sem atividade registrada";

export default async function HealthPage() {
  const { supabase } = await requireAdmin();
  const [commercial, outreach, connection, search, sends] = await Promise.all([
    supabase.from("commercial_settings").select("enabled,channel_authorized,test_mode,last_worker_at,last_sender_at,bridge_connected,bridge_state_changed_at,engine_version").eq("id",1).single(),
    supabase.from("outreach_settings").select("enabled,paused,window_start,window_end,send_days,next_send_at").eq("id",1).single(),
    supabase.rpc("admin_whatsapp_connection"),
    supabase.from("hermes_requests").select("id,run_id,status,created_at,started_at,finished_at,note").order("created_at",{ascending:false}).limit(1).maybeSingle(),
    supabase.from("commercial_outbox").select("id,lead_id,status,provider_id,due_at,sent_at,delivered_at,error,created_at,leads(business_name)").eq("kind","initial").order("created_at",{ascending:false}).limit(50),
  ]);
  if (commercial.error || outreach.error || connection.error || sends.error) return <ErrorBox message="Não foi possível carregar a saúde do sistema." />;
  const c = commercial.data, o = outreach.data, wa = connection.data;
  const items = (sends.data ?? []) as unknown as Outbox[];
  const ids = items.map(item => item.provider_id).filter((id): id is string => !!id);
  const receipts = ids.length ? await supabase.from("whatsapp_receipts").select("external_id,ack").in("external_id", ids) : { data: [] };
  const ack = new Map((receipts.data ?? []).map(row => [row.external_id, row.ack]));
  const last = search.data;
  const problems = [
    !wa?.ready ? "WhatsApp desconectado." : !recent(wa.updated_at, 5) ? "A ponte não atualiza o estado há mais de 5 minutos." : null,
    !c.enabled || !c.channel_authorized ? "Envio comercial desligado ou canal não autorizado." : null,
    !o.enabled ? "Chave de envio desligada." : o.paused ? "Envio pausado." : null,
    !recent(c.last_sender_at, 10) && o.enabled && !o.paused ? "Enviador sem atividade há mais de 10 minutos." : null,
    items.some(item => item.status === "desconhecido") ? "Há envios de resultado incerto. Confira no WhatsApp antes de qualquer nova tentativa." : null,
  ].filter((x): x is string => !!x);
  const card = (title: string, status: string, activity: string, detail: string) => <div className="card p-4"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-accent">{status}</p><p className="mt-2 text-xs text-muted">Última atividade: {activity}</p><p className="mt-2 text-xs text-muted">{detail}</p></div>;
  const label = (item: Outbox) => {
    const receipt = item.provider_id ? ack.get(item.provider_id) : undefined;
    if (item.status === "desconhecido") return "Revisar no WhatsApp";
    if (item.status === "falhou") return "Falhou";
    if (receipt != null && receipt >= 3) return "Visualizada";
    if ((receipt != null && receipt >= 2) || item.status === "entregue") return "Entregue";
    if (item.status === "enviada" || item.sent_at) return "Enviada";
    if (item.status === "cancelada") return "Cancelada";
    return "Aguardando envio";
  };
  return <>
    <PageHeader title="Saúde do sistema" subtitle="Atividade do Hermes, conexão WhatsApp e situação real das saudações." />
    {problems.length > 0 && <section role="alert" className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100"><strong>Precisa de atenção</strong><ul className="mt-2 list-disc pl-5">{problems.map(p => <li key={p}>{p}</li>)}</ul></section>}
    <div className="mb-5 grid gap-3 md:grid-cols-3">
      {card("Hermes", last?.status === "em_andamento" ? "Pesquisa em andamento" : last?.status === "pendente" ? "Pedido aguardando o PC" : last ? `Último pedido: ${last.status}` : "Nenhum pedido", date(last?.finished_at ?? last?.started_at ?? last?.created_at), last?.note ?? "A pesquisa só avança enquanto o processo do Hermes estiver rodando no PC.")}
      {card("WhatsApp", wa?.ready && recent(wa.updated_at,5) ? "Conectado" : wa?.ready ? "Conexão sem atualização recente" : "Desconectado", date(wa?.updated_at), `Ponte: ${c.bridge_connected ? "conectada" : "sem confirmação"}. ${wa?.state ?? ""}`)}
      {card("Enviador", !o.enabled ? "Desligado" : o.paused ? "Pausado" : recent(c.last_sender_at,10) ? "Ativo" : "Sem atividade recente", date(c.last_sender_at), `Motor ${c.engine_version}; worker: ${date(c.last_worker_at)}; próximo envio: ${date(o.next_send_at)}.`)}
    </div>
    <section className="card p-4"><h2 className="mb-2 font-semibold">Últimas 50 saudações</h2><p className="mb-3 text-xs text-muted">“Visualizada” só aparece quando o WhatsApp informou leitura. “Revisar” indica resultado incerto e não provoca reenvio automático.</p>
      {items.length === 0 ? <p className="text-sm text-muted">Nenhum envio registrado.</p> : <ul className="divide-y divide-line text-sm">{items.map(item => {
        const lead = Array.isArray(item.leads) ? item.leads[0] : item.leads;
        return <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><span><Link className="font-medium text-accent" href={`/conversas?lead=${item.lead_id}`}>{lead?.business_name ?? "Lead"}</Link><span className="ml-2 text-xs text-muted">{date(item.sent_at ?? item.created_at)}</span>{item.error && <span className="mt-1 block text-xs text-rose-300">{item.error}</span>}</span><span className={item.status === "desconhecido" || item.status === "falhou" ? "text-amber-300" : "text-emerald-300"}>{label(item)}</span></li>;
      })}</ul>}
    </section>
  </>;
}
