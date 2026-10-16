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
import { ManualProvider, PendingBubbles, ReplyBox, type Pending } from "./ReplyBox";
import { ChatShell, InfoToggle } from "./ChatShell";
import { STAGE_LABEL } from "@/lib/labels";
import { VoiceReply } from "./VoiceReply";

export const metadata = { title: "Conversas" };
export const dynamic = "force-dynamic";
const FILTERS: { key: ConversationFilter; label: string }[] = [
  { key: "todas", label: "Todas" }, { key: "aguardando", label: "Responderam" }, { key: "minhas", label: "Com você" },
];
type Event = { id: string; occurred_at: string; direction: string; source: string; body: string | null; media: string; external_id: string | null };
const SOURCE: Record<string, string> = { hermes_v4: "Hermes V4", secretaria: "Secretário", secretario: "Secretário", saudacao: "Saudação", abordagem: "Abordagem", lembrete: "Lembrete", manual: "Você · celular", painel: "Você · painel", painel_pendente: "Você · painel (enviando…)", painel_falhou: "Você · painel (falhou)", humana: "Cliente", automatica: "Resposta automática" };

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
  const stored = new Set(events.filter((e) => e.media === "audio" && e.external_id).map((e) => e.external_id as string));
  const audios = stored.size ? await supabase.from("chat_audio").select("external_id").in("external_id", [...stored]) : null;
  const audioIds = new Set(((audios?.data ?? []) as { external_id: string }[]).map((a) => a.external_id));
  const href = (changes: Record<string, string>) => {
    const params = new URLSearchParams({ filtro: filter, ...(term ? { q: term } : {}), ...changes });
    return `/conversas?${params}`;
  };
  const who = (e: Event) => e.direction === "entrada" ? "Cliente" : e.source === "historico_saida" ? "Você · histórico WhatsApp" : e.source === "manual" ? "Você" : "Hermes";
  const textOf = (e: Event) => e.source === "manual" && !e.body ? "(mensagem enviada no celular; conteúdo indisponível)" : e.media !== "texto" ? `[${e.media}] ${e.body ?? ""}`.trim() : e.body ?? "";
  const copyText = current ? [`Conversa com ${current.business_name} (${current.city})${current.phone_e164 ? ` · ${current.phone_e164}` : ""}`, "",
    ...events.map((e) => `[${fmtDateTime(e.occurred_at)}] ${who(e)}: ${textOf(e)}`)].join("\n") : "";
  const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", timeZone: "America/Sao_Paulo" });
  const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
  const visible = events.filter((e) => e.source !== "painel_pendente");
  const pendingInitial: Pending[] = events.filter((e) => e.source === "painel_pendente").map((e) => ({
    key: e.id, serverId: e.id.replace(":painel", ""), body: e.body ?? "", at: e.occurred_at, status: "enviando",
  }));
  const doneIds = events.filter((e) => e.source === "painel" || e.source === "painel_falhou").map((e) => e.id.replace(":painel", ""));
  const box = "lg:h-[calc(100vh-12rem)]";

  const list = (
    <aside className={`card flex h-[60vh] flex-col overflow-hidden ${box}`}>
      <form action="/conversas" className="flex gap-2 border-b border-line p-3">
        <input type="hidden" name="filtro" value={filter} />
        <input id="q" name="q" className="input rounded-full" placeholder="🔎 Buscar nome ou cidade" aria-label="Buscar conversa" defaultValue={term} />
        <button className="btn-ghost rounded-full">Buscar</button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? <p className="p-4 text-sm text-muted">Nenhuma conversa neste filtro.</p> : rows.map((c) => {
          const waiting = conversationState(c) === "aguardando";
          const active = current?.id === c.id;
          return <Link key={c.id} href={href({ lead: c.id, pagina: String(page) })} aria-current={active ? "page" : undefined}
            className={`mx-2 my-1 flex gap-3 rounded-xl px-3 py-3 transition hover:bg-panel-2 ${active ? "bg-gradient-to-r from-accent/30 to-accent-2/10 ring-1 ring-accent/40" : ""}`}>
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${waiting ? "bg-gradient-to-br from-accent to-accent-2 text-white" : "bg-panel-2 text-muted"}`}>{initial(c.business_name)}</span>
            <span className="min-w-0 flex-1">
              <span className="flex justify-between gap-2"><span className="truncate text-sm font-semibold">{c.business_name}</span><span className="shrink-0 text-[10px] text-muted">{haQuanto(c.activity_at)}</span></span>
              <span className={`mt-0.5 line-clamp-1 block text-xs ${waiting ? "font-medium text-slate-100" : "text-slate-400"}`}>{waiting && "● "}{c.last_in_media === "audio" ? "🎤 Áudio recebido" : c.last_in_body ?? "Saudação enviada"}</span>
            </span>
          </Link>;
        })}
      </div>
      <nav aria-label="Páginas de conversas" className="flex items-center justify-between border-t border-line p-3 text-xs text-muted">
        {page > 1 ? <Link href={href({ pagina: String(page - 1) })}>← Anterior</Link> : <span />}
        <span>{inbox.count ?? 0} conversas · pág. {page}</span>
        {page * 30 < (inbox.count ?? 0) ? <Link href={href({ pagina: String(page + 1) })}>Próxima →</Link> : <span />}
      </nav>
    </aside>
  );

  const chat = detailError ? <ErrorBox message="Não foi possível carregar os dados desta conversa. Tente novamente." /> : current ? (
    <section className={`card flex h-[75vh] flex-col overflow-hidden ${box}`}>
      <ManualProvider key={current.id} initial={pendingInitial} doneIds={doneIds}>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 font-semibold text-white">{initial(current.business_name)}</span>
            <div className="min-w-0"><h2 className="truncate font-semibold">{current.business_name}</h2><p className="truncate text-xs text-muted">{current.city}{current.phone_e164 ? ` · ${current.phone_e164}` : ""}</p></div>
          </div>
          <InfoToggle />
        </header>
        <ChatScroll deps={`${current.id}:${visible.length}`}>
          <ol className="space-y-2">
            {visible.map((e, i) => {
              const out = e.direction === "saida";
              const newDay = i === 0 || day(visible[i - 1].occurred_at) !== day(e.occurred_at);
              return <li key={e.id}>
                {newDay && <p className="my-3 text-center"><span className="rounded-full bg-panel px-3 py-1 text-[11px] text-muted">{day(e.occurred_at)}</span></p>}
                <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 shadow-sm sm:max-w-[75%] ${out ? "rounded-br-sm bg-gradient-to-br from-accent/80 to-accent-2/70 text-white" : "rounded-bl-sm bg-panel"} ${e.source === "painel_falhou" ? "!bg-rose-900/50" : ""}`}>
                    <p className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wide ${out ? "text-white/70" : "text-muted"}`}>{out ? SOURCE[e.source] ?? who(e) : who(e) === "Cliente" && e.source === "automatica" ? "Resposta automática" : "Cliente"}</p>
                    {e.media === "audio" ? (
                      e.external_id && audioIds.has(e.external_id) ? <div className="flex items-center gap-2">
                        <audio controls preload="none" className="h-10 w-56 max-w-full" src={`/api/conversas/audio/${encodeURIComponent(e.external_id)}`} />
                        <a href={`/api/conversas/audio/${encodeURIComponent(e.external_id)}?baixar=1`} download title="Baixar áudio" aria-label="Baixar áudio" className="btn-ghost shrink-0 px-2 py-1 text-sm">⬇</a>
                      </div> : <p className="text-sm text-muted">🎤 Áudio (arquivo não disponível)</p>
                    ) : <p className="whitespace-pre-wrap break-words text-sm">{textOf(e)}</p>}
                    <p className={`mt-1 text-right text-[10px] ${out ? "text-white/70" : "text-muted"}`}>{new Date(e.occurred_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</p>
                  </div>
                </div>
              </li>;
            })}
            <PendingBubbles />
            {visible.length === 0 && pendingInitial.length === 0 && <li className="py-8 text-center text-sm text-muted">Nenhuma mensagem registrada.</li>}
          </ol>
        </ChatScroll>
        {events.length === 300 && <p className="px-4 py-1 text-xs text-muted">Exibindo as últimas 300 mensagens.</p>}
        <VoiceReply key={`voice-${current.id}`} leadId={current.id} disabled={!current.phone_e164 || current.do_not_contact} />
        <ReplyBox key={current.id} leadId={current.id} disabled={!current.phone_e164 || current.do_not_contact} />
      </ManualProvider>
    </section>
  ) : <Empty title="Selecione uma conversa">As respostas recebidas pelo WhatsApp aparecem aqui.</Empty>;

  const info = current ? (
    <aside className={`space-y-4 overflow-y-auto ${box}`}>
      <section className="card p-4 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-2xl font-semibold text-white">{initial(current.business_name)}</span>
        <h3 className="mt-2 font-semibold">{current.business_name}</h3>
        <p className="text-xs text-muted">{current.city}</p>
        <dl className="mt-3 space-y-1 text-left text-sm">
          {current.phone_e164 && <div className="flex justify-between gap-2"><dt className="text-muted">WhatsApp</dt><dd>{current.phone_e164}</dd></div>}
          <div className="flex justify-between gap-2"><dt className="text-muted">Etapa</dt><dd>{STAGE_LABEL[current.stage as keyof typeof STAGE_LABEL] ?? current.stage}</dd></div>
          {current.fit_score != null && <div className="flex justify-between gap-2"><dt className="text-muted">Nota</dt><dd>{current.fit_score}</dd></div>}
          {current.secretary_handoff_at && <div className="flex justify-between gap-2"><dt className="text-muted">Atendimento</dt><dd>Com você</dd></div>}
        </dl>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {current.phone_e164 && <a href={`https://wa.me/${current.phone_e164.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="btn-primary">Abrir WhatsApp</a>}
          <CopyResumo text={copyText} label="📋 Copiar conversa" />
          <Link href={`/leads/${current.id}`} className="btn-ghost">Ficha do lead</Link>
        </div>
      </section>
      <ReplyAssistant key={current.id} leadId={current.id} />
      <details className="card p-4">
        <summary className="cursor-pointer font-semibold">Memória do cliente</summary>
        <p className="mb-4 mt-2 text-xs text-muted">Anotações suas sobre este cliente.</p>
        <MemoryForm key={current.id} leadId={current.id} memory={memory?.data as Memory | null} />
      </details>
      <DiagnosisCard d={(diagnosis?.data?.[0] as Diagnosis | undefined) ?? null} olderCount={0} />
    </aside>
  ) : null;

  return (
    <>
      <PageHeader title="💬 Conversas" subtitle="Conversas dos contatos cadastrados. Ao reconectar o WhatsApp, o histórico disponível é importado automaticamente." />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => <Link key={f.key} href={href({ filtro: f.key })} className={filter === f.key ? "btn-primary" : "btn-ghost"}>{f.label}</Link>)}
      </div>
      <ChatShell list={list} chat={chat} info={info} />
    </>
  );
}
