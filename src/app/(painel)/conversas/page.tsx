import Link from "next/link";
import { DiagnosisCard, type Diagnosis } from "@/components/leads/DiagnosisCard";
import { Empty, ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { CopyResumo } from "@/components/leads/CopyResumo";
import { CONVERSATION_LABEL, conversationState, type Conversation, type ConversationFilter } from "@/lib/conversations";
import { fmtDateTime, haQuanto } from "@/lib/time";
import { MemoryForm, type Memory } from "./MemoryForm";
import { ChatScroll } from "./ChatScroll";
import { ReplyAssistant } from "./ReplyAssistant";

export const metadata = { title: "Conversas" };
export const dynamic = "force-dynamic";
const FILTERS: { key: ConversationFilter; label: string }[] = [
  { key: "todas", label: "Todas" }, { key: "aguardando", label: "Responderam" }, { key: "minhas", label: "Com você" },
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
  const [inbox] = await Promise.all([
    query.order("activity_at", { ascending: false }).order("id").range((page - 1) * 30, page * 30 - 1),
  ]);
  if (inbox.error) return <><PageHeader title="Conversas" /><ErrorBox message="Não foi possível carregar a central. Confira se a atualização do banco foi aplicada." /></>;
  const rows = (inbox.data ?? []) as Conversation[];
  const selectedId = sp.lead && /^[0-9a-f-]{36}$/i.test(sp.lead) ? sp.lead : rows[0]?.id;
  const [selected, history, memory, diagnosis] = selectedId ? await Promise.all([
    supabase.from("conversation_inbox").select("*").eq("id", selectedId).maybeSingle(),
    supabase.from("conversation_timeline").select("*").eq("lead_id", selectedId).order("occurred_at", { ascending: false }).order("id").limit(300),
    supabase.from("lead_conversation_memory").select("summary, facts, objections, next_action, updated_at").eq("lead_id", selectedId).maybeSingle(),
    supabase.from("lead_diagnoses").select("*").eq("lead_id", selectedId).order("created_at", { ascending: false }).limit(1),
  ]) : [null, null, null, null];
  const current = selected?.data as Conversation | null;
  const detailError = selected?.error || history?.error || memory?.error || diagnosis?.error;
  const events = [...(history?.data ?? []) as Event[]].reverse();
  const href = (changes: Record<string, string>) => {
    const params = new URLSearchParams({ filtro: filter, ...(term ? { q: term } : {}), ...changes });
    return `/conversas?${params}`;
  };
  const who = (e: Event) => e.direction === "entrada" ? "Cliente" : e.source === "manual" ? "Você" : "Hermes";
  const textOf = (e: Event) => e.source === "manual" && !e.body ? "(mensagem enviada no celular; conteúdo indisponível)" : e.media !== "texto" ? `[${e.media}] ${e.body ?? ""}`.trim() : e.body ?? "";
  const copyText = current ? [`Conversa com ${current.business_name} (${current.city})${current.phone_e164 ? ` · ${current.phone_e164}` : ""}`, "",
    ...events.map((e) => `[${fmtDateTime(e.occurred_at)}] ${who(e)}: ${textOf(e)}`)].join("\n") : "";
  const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", timeZone: "America/Sao_Paulo" });
  const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
  return (
    <>
      <PageHeader title="💬 Conversas" subtitle="Quem respondeu à saudação aparece aqui. A conversa é sua." />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => <Link key={f.key} href={href({ filtro: f.key })} className={filter === f.key ? "btn-primary" : "btn-ghost"}>{f.label}</Link>)}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)_340px]">
        <aside className="card overflow-hidden">
          <form action="/conversas" className="flex gap-2 border-b border-line p-3">
            <input type="hidden" name="filtro" value={filter} />
            <input id="q" name="q" className="input" placeholder="🔎 Buscar nome ou cidade" aria-label="Buscar conversa" defaultValue={term} />
            <button className="btn-ghost">Buscar</button>
          </form>
          <div className="max-h-[70vh] overflow-y-auto">
            {rows.length === 0 ? <p className="p-4 text-sm text-muted">Nenhuma conversa neste filtro.</p> : rows.map((c) => {
              const waiting = conversationState(c) === "aguardando";
              return <Link key={c.id} href={href({ lead: c.id, pagina: String(page) })} aria-current={current?.id === c.id ? "page" : undefined}
                className={`flex gap-3 border-b border-line px-4 py-3 transition hover:bg-panel-2 ${current?.id === c.id ? "border-l-2 border-l-accent bg-accent/10" : ""}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${waiting ? "bg-emerald-500/25 text-emerald-200" : "bg-panel-2 text-muted"}`}>{initial(c.business_name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex justify-between gap-2"><span className="truncate text-sm font-semibold">{c.business_name}</span><span className="shrink-0 text-[10px] text-muted">{haQuanto(c.activity_at)}</span></span>
                  <span className="block truncate text-xs text-muted">{c.city}</span>
                  <span className={`mt-1 line-clamp-1 block text-xs ${waiting ? "font-medium text-slate-100" : "text-slate-400"}`}>{waiting && "● "}{c.last_in_media === "audio" ? "🎤 Áudio recebido" : c.last_in_body ?? "Saudação enviada"}</span>
                </span>
              </Link>;
            })}
          </div>
          <nav aria-label="Páginas de conversas" className="flex items-center justify-between p-3 text-xs text-muted">
            {page > 1 ? <Link href={href({ pagina: String(page - 1) })}>← Anterior</Link> : <span />}
            <span>{inbox.count ?? 0} conversas · pág. {page}</span>
            {page * 30 < (inbox.count ?? 0) ? <Link href={href({ pagina: String(page + 1) })}>Próxima →</Link> : <span />}
          </nav>
        </aside>
        {detailError ? <ErrorBox message="Não foi possível carregar os dados desta conversa. Tente novamente." /> : current ? (
          <>
            <section className="card overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/20 font-semibold">{initial(current.business_name)}</span>
                  <div className="min-w-0"><h2 className="truncate font-semibold">{current.business_name}</h2><p className="truncate text-xs text-muted">{current.city}{current.phone_e164 ? ` · ${current.phone_e164}` : ""}</p></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {current.phone_e164 && <a href={`https://wa.me/${current.phone_e164.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="btn-primary">Abrir WhatsApp</a>}
                  <CopyResumo text={copyText} label="📋 Copiar conversa" />
                  <Link href={`/leads/${current.id}`} className="btn-ghost">Ficha do lead</Link>
                </div>
              </header>
              <ChatScroll deps={`${current.id}:${events.length}`}>
                <ol className="space-y-2">
                  {events.map((e, i) => {
                    const out = e.direction === "saida";
                    const newDay = i === 0 || day(events[i - 1].occurred_at) !== day(e.occurred_at);
                    return <li key={e.id}>
                      {newDay && <p className="my-3 text-center"><span className="rounded-full bg-panel px-3 py-1 text-[11px] text-muted">{day(e.occurred_at)}</span></p>}
                      <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 shadow-sm sm:max-w-[75%] ${out ? "rounded-br-sm bg-accent/20" : "rounded-bl-sm bg-panel"}`}>
                          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{out ? SOURCE[e.source] ?? who(e) : who(e) === "Cliente" && e.source === "automatica" ? "Resposta automática" : "Cliente"}</p>
                          <p className="whitespace-pre-wrap break-words text-sm">{textOf(e)}</p>
                          <p className="mt-1 text-right text-[10px] text-muted">{new Date(e.occurred_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</p>
                        </div>
                      </div>
                    </li>;
                  })}
                  {events.length === 0 && <li className="py-8 text-center text-sm text-muted">Nenhuma mensagem registrada.</li>}
                </ol>
              </ChatScroll>
              {events.length === 300 && <p className="px-4 py-2 text-xs text-muted">Exibindo as últimas 300 mensagens.</p>}
            </section>
            <aside className="space-y-4 lg:col-start-2 2xl:col-start-3">
              <ReplyAssistant key={current.id} leadId={current.id} />
              <details className="card p-4">
                <summary className="cursor-pointer font-semibold">Memória do cliente</summary>
                <p className="mb-4 mt-2 text-xs text-muted">Anotações suas sobre este cliente.</p>
                <MemoryForm key={current.id} leadId={current.id} memory={memory?.data as Memory | null} />
              </details>
              <DiagnosisCard d={(diagnosis?.data?.[0] as Diagnosis | undefined) ?? null} olderCount={0} />
            </aside>
          </>
        ) : <Empty title="Selecione uma conversa">As respostas recebidas pelo WhatsApp aparecem aqui.</Empty>}
      </div>
    </>
  );
}
