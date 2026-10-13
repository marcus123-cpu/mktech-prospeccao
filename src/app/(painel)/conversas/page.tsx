import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { DiagnosisCard, type Diagnosis } from "@/components/leads/DiagnosisCard";
import { Empty, ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { CONVERSATION_LABEL, conversationState, type Conversation, type ConversationFilter } from "@/lib/conversations";
import { fmtDateTime, haQuanto } from "@/lib/time";
import { setConversationOwner } from "./actions";
import { MemoryForm, type Memory } from "./MemoryForm";
import { ReplyAssistant } from "./ReplyAssistant";

export const metadata = { title: "Conversas" };
export const dynamic = "force-dynamic";
const FILTERS: { key: ConversationFilter; label: string }[] = [
  { key: "todas", label: "Todas" }, { key: "minhas", label: "Com você" },
  { key: "aguardando", label: "Esperando resposta" }, { key: "bot", label: "Bot na fila" },
];
type Event = { id: string; occurred_at: string; direction: string; source: string; body: string | null; media: string };
const SOURCE: Record<string, string> = { hermes_v4: "Hermes V4", secretaria: "Secretário", secretario: "Secretário", saudacao: "Saudação", abordagem: "Abordagem", lembrete: "Lembrete", manual: "Você · celular", humana: "Cliente", automatica: "Resposta automática" };

export default async function Conversations({ searchParams }: { searchParams: Promise<{ lead?: string; filtro?: string; q?: string; pagina?: string }> }) {
  const sp = await searchParams;
  const filter = FILTERS.some((f) => f.key === sp.filtro) ? sp.filtro as ConversationFilter : "todas";
  const page = Math.max(1, Math.min(10000, Number.parseInt(sp.pagina ?? "1", 10) || 1));
  const term = (sp.q ?? "").replace(/[,()%*\\]/g, " ").trim().slice(0, 80);
  const { supabase } = await requireAdmin();
  let query = supabase.from("conversation_inbox").select("*", { count: "exact" });
  if (term) query = query.or(`business_name.ilike.%${term}%,city.ilike.%${term}%`);
  if (filter === "minhas") query = query.not("secretary_handoff_at", "is", null).eq("do_not_contact", false).not("stage", "in", "(fechado,sem_interesse,desqualificado)");
  if (filter === "bot") query = query.in("pending_status", ["pronta", "enviando"]).is("secretary_handoff_at", null).eq("do_not_contact", false).not("stage", "in", "(fechado,sem_interesse,desqualificado)");
  // A condição temporal é calculada no banco, antes da paginação.
  if (filter === "aguardando") query = query.eq("needs_reply", true);
  const [inbox, settings] = await Promise.all([
    query.order("activity_at", { ascending: false }).order("id").range((page - 1) * 30, page * 30 - 1),
    supabase.from("outreach_settings").select("enabled, paused, secretary_enabled").eq("id", 1).maybeSingle(),
  ]);
  if (inbox.error) return <><PageHeader title="Conversas" /><ErrorBox message="Não foi possível carregar a central. Confira se a atualização do banco foi aplicada." /></>;
  const rows = (inbox.data ?? []) as Conversation[];
  const selectedId = sp.lead && /^[0-9a-f-]{36}$/i.test(sp.lead) ? sp.lead : rows[0]?.id;
  const [selected, history, memory, diagnosis] = selectedId ? await Promise.all([
    supabase.from("conversation_inbox").select("*").eq("id", selectedId).maybeSingle(),
    supabase.from("conversation_timeline").select("*").eq("lead_id", selectedId).order("occurred_at", { ascending: false }).order("id").limit(100),
    supabase.from("lead_conversation_memory").select("summary, facts, objections, next_action, updated_at").eq("lead_id", selectedId).maybeSingle(),
    supabase.from("lead_diagnoses").select("*").eq("lead_id", selectedId).order("created_at", { ascending: false }).limit(1),
  ]) : [null, null, null, null];
  const current = selected?.data as Conversation | null;
  const detailError = selected?.error || history?.error || memory?.error || diagnosis?.error;
  const events = [...(history?.data ?? []) as Event[]].reverse();
  const botActive = settings.data?.enabled && !settings.data.paused && settings.data.secretary_enabled;
  const href = (changes: Record<string, string>) => {
    const params = new URLSearchParams({ filtro: filter, ...(term ? { q: term } : {}), ...changes });
    return `/conversas?${params}`;
  };
  return (
    <>
      <PageHeader title="Conversas" subtitle="Histórico, diagnóstico e próxima ação no mesmo lugar."
        actions={<><span className={`badge ${botActive ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>Secretário {botActive ? "liberado" : "pausado ou desligado"}</span><Link href="/envio" className="btn-ghost">Configurar bot</Link></>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => <Link key={f.key} href={href({ filtro: f.key })} className={filter === f.key ? "btn-primary" : "btn-ghost"}>{f.label}</Link>)}
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        <aside className="card overflow-hidden">
          <form action="/conversas" className="border-b border-line p-3">
            <input type="hidden" name="filtro" value={filter} />
            <label htmlFor="q" className="label">Buscar conversa</label>
            <div className="flex gap-2"><input id="q" name="q" className="input" placeholder="Nome ou cidade" defaultValue={term} /><button className="btn-ghost">Buscar</button></div>
          </form>
          <div className="max-h-[65vh] overflow-y-auto">
            {rows.length === 0 ? <p className="p-4 text-sm text-muted">Nenhuma conversa neste filtro.</p> : rows.map((c) => (
              <Link key={c.id} href={href({ lead: c.id, pagina: String(page) })} aria-current={current?.id === c.id ? "page" : undefined}
                className={`block border-b border-line p-4 transition hover:bg-panel-2 ${current?.id === c.id ? "border-l-2 border-l-accent bg-accent/10" : ""}`}>
                <div className="flex justify-between gap-2"><span className="text-sm font-semibold">{c.business_name}</span><span className="shrink-0 text-[10px] text-muted">{haQuanto(c.activity_at)}</span></div>
                <div className="mt-1 text-xs text-muted">{c.city} · {CONVERSATION_LABEL[conversationState(c)]}</div>
                <p className="mt-2 line-clamp-2 text-xs text-slate-300">{c.last_in_media === "audio" ? "Áudio recebido" : c.last_in_body ?? c.secretary_handoff_reason ?? "Atendimento iniciado"}</p>
              </Link>
            ))}
          </div>
          <nav aria-label="Páginas de conversas" className="flex items-center justify-between p-3 text-xs text-muted">
            {page > 1 ? <Link href={href({ pagina: String(page - 1) })}>Anterior</Link> : <span />}
            <span>{inbox.count ?? 0} conversas · pág. {page}</span>
            {page * 30 < (inbox.count ?? 0) ? <Link href={href({ pagina: String(page + 1) })}>Próxima</Link> : <span />}
          </nav>
        </aside>
        {detailError ? <ErrorBox message="Não foi possível carregar os dados desta conversa. Tente novamente." /> : current ? (
          <>
            <section className="card overflow-hidden">
              <header className="space-y-3 border-b border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><h2 className="font-semibold">{current.business_name}</h2><p className="text-xs text-muted">{current.city} · {CONVERSATION_LABEL[conversationState(current)]}</p></div>
                  <Link href={`/leads/${current.id}`} className="btn-ghost">Ficha do lead</Link>
                </div>
                {current.secretary_handoff_reason && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">Motivo do atendimento: {current.secretary_handoff_reason}</p>}
                <div className="flex flex-wrap gap-2">
                  {current.phone_e164 && <a href={`https://wa.me/${current.phone_e164.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="btn-primary">Abrir WhatsApp</a>}
                  {conversationState(current) !== "encerrada" && <ActionForm action={setConversationOwner}
                    submit={current.secretary_handoff_at ? "Devolver ao secretário" : "Assumir atendimento"} variant="btn-ghost">
                    <input type="hidden" name="lead_id" value={current.id} /><input type="hidden" name="owner" value={current.secretary_handoff_at ? "secretario" : "marcos"} />
                  </ActionForm>}
                </div>
              </header>
              <ol className="max-h-[65vh] space-y-3 overflow-y-auto p-4" aria-label="Histórico da conversa">
                {events.map((e) => <li key={e.id} className={`flex ${e.direction === "saida" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[90%] rounded-xl p-3 sm:max-w-[80%] ${e.direction === "saida" ? "bg-accent/15" : "bg-panel-2"}`}>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">{SOURCE[e.source] ?? e.source}</p>
                    <p className="whitespace-pre-wrap break-words text-sm">{e.source === "manual" && !e.body ? "Mensagem antiga enviada no celular; conteúdo indisponível." : e.media !== "texto" ? `[${e.media}] ${e.body ?? ""}` : e.body}</p>
                    <p className="mt-2 text-right text-[10px] text-muted">{fmtDateTime(e.occurred_at)}</p>
                  </div>
                </li>)}
                {events.length === 0 && <li className="text-sm text-muted">Nenhuma mensagem registrada.</li>}
              </ol>
              {events.length === 100 && <p className="px-4 pb-3 text-xs text-muted">Exibindo as últimas 100 mensagens.</p>}
              {current.pending_status && <div className="border-t border-line p-4"><p className="label">Resposta do bot · {current.pending_status}</p><p className="whitespace-pre-wrap text-sm">{current.pending_body}</p></div>}
            </section>
            <aside className="space-y-4">
              <ReplyAssistant key={current.id} leadId={current.id} />
              <section className="card p-4"><h2 className="mb-1 font-semibold">Memória do cliente</h2><p className="mb-4 text-xs text-muted">Informações confirmadas por você. O bot lê esta memória junto da conversa antes de responder.</p>
                <MemoryForm key={current.id} leadId={current.id} memory={memory?.data as Memory | null} />
              </section>
              <DiagnosisCard d={(diagnosis?.data?.[0] as Diagnosis | undefined) ?? null} olderCount={0} />
            </aside>
          </>
        ) : <Empty title="Selecione uma conversa">As respostas recebidas pelo WhatsApp aparecem aqui.</Empty>}
      </div>
    </>
  );
}
