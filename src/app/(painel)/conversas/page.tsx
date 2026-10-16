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

  const list = (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-[#111b21]">
      <header className="flex h-16 shrink-0 items-center justify-between px-5">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#e9edef]">Conversas</h1>
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-[#8696a0]">{inbox.count ?? 0} contatos</span>
      </header>
      <form action="/conversas" className="flex gap-1 px-3 pb-3">
        <input type="hidden" name="filtro" value={filter} />
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg bg-[#202c33] px-3">
          <svg width="17" height="17" className="shrink-0 text-[#8696a0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input id="q" name="q" className="h-9 w-full min-w-0 bg-transparent text-[13px] text-[#e9edef] outline-none placeholder:text-[#8696a0]" placeholder="Pesquisar nome ou cidade" aria-label="Buscar conversa" defaultValue={term} />
          <button className="rounded px-1 py-2 text-[11px] text-[#8696a0] hover:text-white">Buscar</button>
        </div>
      </form>
      <nav aria-label="Filtrar conversas" className="flex shrink-0 gap-2 border-b border-white/5 px-3 pb-3">
        {FILTERS.map((f) => <Link key={f.key} href={href({ filtro: f.key })} aria-current={filter === f.key ? "page" : undefined}
          className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition ${filter === f.key ? "bg-[#0a332c] text-[#00d9a4]" : "bg-[#202c33] text-[#8696a0] hover:bg-[#2a3942] hover:text-[#e9edef]"}`}>{f.label}</Link>)}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? <p className="p-4 text-sm text-muted">Nenhuma conversa neste filtro.</p> : rows.map((c) => {
          const waiting = conversationState(c) === "aguardando";
          const active = current?.id === c.id;
          return <Link key={c.id} href={href({ lead: c.id, pagina: String(page) })} aria-current={active ? "page" : undefined}
            className={`flex gap-3 border-b border-white/5 px-4 py-4 transition hover:bg-[#202c33] ${active ? "bg-[#2a3942]" : ""}`}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2d4147] text-base font-medium text-[#c5d4d6]">{initial(c.business_name)}</span>
            <span className="min-w-0 flex-1">
              <span className="flex justify-between gap-2"><span className="truncate text-[14px] font-medium text-[#e9edef]">{c.business_name}</span><span className={`shrink-0 text-[10px] ${waiting ? "text-[#00a884]" : "text-[#8696a0]"}`}>{haQuanto(c.activity_at)}</span></span>
              <span className="mt-1 flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[12px] text-[#8696a0]">{c.last_in_media === "audio" ? "Mensagem de voz" : c.last_in_body ?? "Conversa iniciada"}</span>{waiting && <span title="Aguardando resposta" className="h-2 w-2 shrink-0 rounded-full bg-[#00a884]" />}</span>
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
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0b141a]">
      <ManualProvider key={current.id} initial={pendingInitial} doneIds={doneIds}>
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/5 bg-[#202c33] px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link href={href({})} className="flex h-9 w-8 shrink-0 items-center justify-center rounded-full text-[#aebac1] hover:bg-white/10 md:hidden" aria-label="Voltar para lista de conversas">←</Link>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#40565c] font-medium text-[#e9edef]">{initial(current.business_name)}</span>
            <div className="min-w-0"><h2 className="truncate text-[14px] font-medium text-[#e9edef]">{current.business_name}</h2><p className="mt-0.5 truncate text-[11px] text-[#8696a0]">{current.city}{current.phone_e164 ? ` · ${current.phone_e164}` : ""}</p></div>
          </div>
          <InfoToggle />
        </header>
        <ChatScroll deps={`${current.id}:${visible.length}`}>
          <ol className="space-y-2">
            {visible.map((e, i) => {
              const out = e.direction === "saida";
              const newDay = i === 0 || day(visible[i - 1].occurred_at) !== day(e.occurred_at);
              return <li key={e.id}>
                {newDay && <p className="my-3 text-center"><span className="rounded-lg bg-[#182229] px-3 py-1 text-[11px] text-[#8696a0] shadow">{day(e.occurred_at)}</span></p>}
                <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[90%] rounded-lg px-3 py-2 shadow-sm sm:max-w-[78%] xl:max-w-[68%] ${out ? "rounded-tr-none bg-[#005c4b] text-[#e9edef]" : "rounded-tl-none bg-[#202c33] text-[#e9edef]"} ${e.source === "painel_falhou" ? "!bg-rose-900/50" : ""}`}>
                    {(e.source === "painel_falhou" || e.source === "automatica" || ["hermes_v4", "secretario", "secretaria"].includes(e.source)) && <p className="mb-1 text-[10px] font-medium text-white/50">{SOURCE[e.source] ?? who(e)}</p>}
                    {e.media === "audio" ? (
                      e.external_id && audioIds.has(e.external_id) ? <div className="flex items-center gap-2">
                        <audio controls preload="none" className="h-10 w-56 max-w-full" src={`/api/conversas/audio/${encodeURIComponent(e.external_id)}`} />
                        <a href={`/api/conversas/audio/${encodeURIComponent(e.external_id)}?baixar=1`} download title="Baixar áudio" aria-label="Baixar áudio" className="btn-ghost shrink-0 px-2 py-1 text-sm">⬇</a>
                      </div> : <p className="text-sm text-muted">🎤 Áudio (arquivo não disponível)</p>
                    ) : <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.55]">{textOf(e)}</p>}
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
    <aside className="space-y-4">
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
      <ChatShell list={list} chat={chat} info={info} selected={!!sp.lead} />
    </>
  );
}
