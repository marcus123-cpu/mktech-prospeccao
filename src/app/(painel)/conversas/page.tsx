import Link from "next/link";
import { ContactNotes } from "./ContactNotes";
import { ConversationLink } from "./ConversationLink";
import { Empty, ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { CopyResumo } from "@/components/leads/CopyResumo";
import { diagnosisText, type Diagnosis } from "@/components/leads/DiagnosisCard";
import { CONVERSATION_LABEL, conversationState, type Conversation, type ConversationFilter } from "@/lib/conversations";
import { fmtDateTime, haQuanto } from "@/lib/time";
import { ChatScroll } from "./ChatScroll";
import { ManualProvider, PendingBubbles, ReplyBox, type Pending } from "./ReplyBox";
import { ChatShell, InfoToggle } from "./ChatShell";
import { STAGE_LABEL } from "@/lib/labels";
import { receiptLabel } from "@/lib/message-receipts";
import { SeenConversation } from "./SeenConversation";

export const metadata = { title: "Conversas" };
export const dynamic = "force-dynamic";
const FILTERS: { key: ConversationFilter; label: string }[] = [
  { key: "todas", label: "Todas" }, { key: "nao_lidas", label: "Não lidas" }, { key: "aguardando", label: "Falta responder" }, { key: "minhas", label: "Com você" },
];
type Event = { id: string; occurred_at: string; direction: string; source: string; body: string | null; media: string; external_id: string | null; receipt_ack?: number | null };
const SOURCE: Record<string, string> = { hermes_v4: "Hermes V4", secretaria: "Secretário", secretario: "Secretário", saudacao: "Saudação", abordagem: "Abordagem", lembrete: "Lembrete", manual: "Você · celular", painel: "Você · painel", painel_pendente: "Você · painel (enviando…)", painel_falhou: "Você · painel (falhou)", humana: "Cliente", automatica: "Resposta automática" };

export default async function Conversations({ searchParams }: { searchParams: Promise<{ lead?: string; filtro?: string; q?: string; pagina?: string }> }) {
  const sp = await searchParams;
  const filter = FILTERS.some((f) => f.key === sp.filtro) ? sp.filtro as ConversationFilter : "todas";
  const page = Math.max(1, Math.min(10000, Number.parseInt(sp.pagina ?? "1", 10) || 1));
  const term = (sp.q ?? "").replace(/[,()%*\\]/g, " ").trim().slice(0, 80);
  const { supabase } = await requireAdmin();
  const unreadRequest = supabase.from("conversation_unread").select("id");
  const unreadResult = filter === "nao_lidas" ? await unreadRequest : null;
  let query = supabase.from("conversation_inbox").select("*");
  if (filter === "nao_lidas") query = query.in("id", (unreadResult?.data ?? []).map((r: {id: string}) => r.id));
  if (term) query = query.or(`business_name.ilike.%${term}%,city.ilike.%${term}%`);
  if (filter === "minhas") query = query.not("secretary_handoff_at", "is", null).eq("do_not_contact", false).not("stage", "in", "(fechado,sem_interesse,desqualificado)");
  if (filter === "bot") query = query.in("pending_status", ["pronta", "enviando"]).is("secretary_handoff_at", null).eq("do_not_contact", false).not("stage", "in", "(fechado,sem_interesse,desqualificado)");
  // A condição temporal é calculada no banco, antes da paginação.
  if (filter === "aguardando") query = query.eq("needs_reply", true);
  const explicitId = sp.lead && /^[0-9a-f-]{36}$/i.test(sp.lead) ? sp.lead : undefined;
  const loadDetail = async (id: string) => await supabase.rpc("admin_conversation_detail", {p_lead:id,p_limit:300});
  const detailRequest = explicitId ? loadDetail(explicitId) : null;
  const diagnosisRequest = (id: string) => supabase.from("lead_diagnoses").select("id,fit_score,confidence,summary,audience,digital_presence,pains,opportunities,offer,offer_reason,approach,objections,created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const earlyDiagnosis = explicitId ? diagnosisRequest(explicitId) : null;
  const [inbox, unread] = await Promise.all([
    query.order("activity_at", { ascending: false }).order("id").range((page - 1) * 30, page * 30), // 31 linhas: a 31ª só avisa que existe próxima página (sem contar tudo)
    unreadResult ?? unreadRequest,
  ]);
  const unreadIds = new Set((unread.data ?? []).map((row: { id: string }) => row.id));
  const tabCount: Partial<Record<ConversationFilter, number>> = { nao_lidas: unreadIds.size };
  if (inbox.error) return <><PageHeader title="Conversas" /><ErrorBox message="Não foi possível carregar a central." /></>;
  const allRows = (inbox.data ?? []) as Conversation[];
  const hasNext = allRows.length > 30;
  const rows = allRows.slice(0, 30);
  const selectedId = explicitId ?? rows[0]?.id;
  let detail = detailRequest ? await detailRequest : selectedId ? await loadDetail(selectedId) : null;
  // Com o banco ocupado a consulta pode estourar o tempo: tenta uma segunda vez antes de mostrar erro.
  if (detail?.error && selectedId) detail = await loadDetail(selectedId);
  const current = (detail?.data?.current ?? null) as Conversation | null;
  const detailError = detail?.error;
  const { data: diagnosis } = current
    ? await (earlyDiagnosis && explicitId === current.id ? earlyDiagnosis : diagnosisRequest(current.id))
    : { data: null };
  const events = [...(detail?.data?.events ?? []) as Event[]].reverse();
  const audioIds = new Set<string>(detail?.data?.audio_ids ?? []);
  const href = (changes: Record<string, string>) => {
    const params = new URLSearchParams({ filtro: filter, ...(term ? { q: term } : {}), ...changes });
    return `/conversas?${params}`;
  };
  const who = (e: Event) => e.direction === "entrada" ? "Cliente" : e.source === "historico_saida" ? "Você · histórico WhatsApp" : ["manual", "painel", "painel_falhou"].includes(e.source) ? "Você" : "Hermes";
  const textOf = (e: Event) => e.source === "manual" && !e.body ? "(mensagem enviada no celular; conteúdo indisponível)" : e.media !== "texto" ? `[${e.media}] ${e.body ?? ""}`.trim() : e.body ?? "";
  const copyText = current ? [`Conversa com ${current.business_name} (${current.city})${current.phone_e164 ? ` · ${current.phone_e164}` : ""}`, "",
    ...events.map((e) => `[${fmtDateTime(e.occurred_at)}] ${who(e)}: ${textOf(e)}`)].join("\n") : "";
  const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", timeZone: "America/Sao_Paulo" });
  const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
  const AVATARS = ["from-violet-500 to-fuchsia-500", "from-sky-500 to-indigo-500", "from-emerald-500 to-teal-500", "from-amber-500 to-orange-500", "from-rose-500 to-pink-500", "from-cyan-500 to-blue-500", "from-lime-500 to-emerald-500"];
  const avatar = (name: string) => AVATARS[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATARS.length];
  const visible = events.filter((e) => e.source !== "painel_pendente");
  const pendingInitial: Pending[] = events.filter((e) => e.source === "painel_pendente").map((e) => ({
    key: e.id, serverId: e.id.replace(":painel", ""), body: e.body ?? "", at: e.occurred_at, status: "enviando",
  }));
  const doneIds = events.filter((e) => e.source === "painel" || e.source === "painel_falhou").map((e) => e.id.replace(":painel", ""));

  const list = (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-[#111b21]">
      <header className="flex h-16 shrink-0 items-center justify-between px-5">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#e9edef]">Conversas</h1>
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-[#8696a0]">{rows.length}{hasNext ? "+" : ""} nesta página</span>
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
          className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition ${filter === f.key ? "bg-[#0a332c] text-[#00d9a4]" : "bg-[#202c33] text-[#8696a0] hover:bg-[#2a3942] hover:text-[#e9edef]"}`}>{f.label}{!!tabCount[f.key] && <span className={`ml-1.5 rounded-full px-1.5 py-px text-[10px] font-bold ${f.key === "nao_lidas" ? "bg-[#00a884] text-white" : "bg-amber-500 text-black"}`}>{tabCount[f.key]}</span>}</Link>)}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? <p className="p-4 text-sm text-muted">Nenhuma conversa neste filtro.</p> : rows.map((c) => {
          const waiting = !!c.last_in_at && (!c.last_out_at || Date.parse(c.last_in_at) > Date.parse(c.last_out_at));
          const isUnread = unreadIds.has(c.id);
          const active = current?.id === c.id;
          // Três estados que se enxergam de longe: NOVA (não abri), FALTA RESPONDER (abri, não respondi) e em dia.
          const tone = active ? "border-l-4 border-l-[#00d9a4] bg-gradient-to-r from-[#00a884]/25 to-[#2a3942]"
            : isUnread ? "border-l-4 border-l-[#00d9a4] bg-[#00a884]/12 hover:bg-[#00a884]/20"
            : waiting ? "border-l-4 border-l-amber-400 hover:bg-[#202c33]"
            : "border-l-4 border-l-transparent hover:bg-[#202c33]";
          return <ConversationLink key={c.id} leadId={c.id} name={c.business_name} active={active} isUnread={isUnread} lastInAt={c.last_in_at} href={href({ lead: c.id, pagina: String(page) })} aria-current={active ? "page" : undefined}
            className={`flex gap-3 border-b border-white/5 px-4 py-4 transition ${tone}`}>
            <span className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${avatar(c.business_name)} text-base font-semibold text-white shadow-md ${isUnread || active ? "" : "opacity-70"}`}>{initial(c.business_name)}{isUnread && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#111b21] bg-[#00d9a4]" />}</span>
            <span className="min-w-0 flex-1">
              <span className="flex justify-between gap-2"><span className={`truncate text-[14px] ${isUnread ? "font-bold text-white" : "font-medium text-[#b6c2c9]"}`}>{c.business_name}</span><span className={`shrink-0 text-[10px] ${isUnread ? "font-semibold text-[#00d9a4]" : "text-[#8696a0]"}`}>{haQuanto(c.activity_at)}</span></span>
              <span className="mt-1 flex items-center gap-2"><span className={`min-w-0 flex-1 truncate text-[12px] ${isUnread ? "font-semibold text-[#e9edef]" : "text-[#8696a0]"}`}>{c.last_message_direction === "saida" ? "Você: " : ""}{c.last_message_media === "audio" ? "🎤 Mensagem de voz" : c.last_message_body ?? c.last_in_body ?? "Conversa iniciada"}</span>
                {isUnread ? <span className="shrink-0 rounded-full bg-[#00a884] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Nova</span> : waiting && <span title="Você abriu mas ainda não respondeu" className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">Falta responder</span>}</span>
            </span>
          </ConversationLink>;
        })}
      </div>
      <nav aria-label="Páginas de conversas" className="flex items-center justify-between border-t border-line p-3 text-xs text-muted">
        {page > 1 ? <Link href={href({ pagina: String(page - 1) })}>← Anterior</Link> : <span />}
        <span>pág. {page}</span>
        {hasNext ? <Link href={href({ pagina: String(page + 1) })}>Próxima →</Link> : <span />}
      </nav>
    </aside>
  );

  const chat = detailError ? <ErrorBox message="Não foi possível carregar os dados desta conversa. Tente novamente." /> : current ? (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0b141a]">
      <SeenConversation leadId={current.id} at={current.last_in_at} explicit={!!sp.lead} />
      <ManualProvider key={current.id} initial={pendingInitial} doneIds={doneIds}>
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-white/5 bg-gradient-to-r from-[#202c33] via-[#1f2f3d] to-[#23304a] px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link href={href({})} className="flex h-9 w-8 shrink-0 items-center justify-center rounded-full text-[#aebac1] hover:bg-white/10 md:hidden" aria-label="Voltar para lista de conversas">←</Link>
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${avatar(current.business_name)} font-semibold text-white`}>{initial(current.business_name)}</span>
            <div className="min-w-0"><h2 className="truncate text-[14px] font-medium text-[#e9edef]">{current.business_name}</h2><p className="mt-0.5 truncate text-[11px] text-[#8696a0]">{current.city}{current.phone_e164 ? ` · ${current.phone_e164}` : ""}</p></div>
          </div>
          <div className="mr-12"><InfoToggle /></div>
        </header>
        <ChatScroll deps={`${current.id}:${visible.length}`}>
          <ol className="space-y-2">
            {visible.map((e, i) => {
              const out = e.direction === "saida";
              const newDay = i === 0 || day(visible[i - 1].occurred_at) !== day(e.occurred_at);
              return <li key={e.id}>
                {newDay && <p className="my-3 text-center"><span className="rounded-lg bg-[#182229] px-3 py-1 text-[11px] text-[#8696a0] shadow">{day(e.occurred_at)}</span></p>}
                <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[90%] rounded-lg px-3 py-2 shadow-sm sm:max-w-[78%] xl:max-w-[68%] ${out ? "rounded-tr-none bg-gradient-to-br from-[#08856b] to-[#005c4b] text-white" : "rounded-tl-none border border-indigo-400/20 bg-gradient-to-br from-[#2b3567] to-[#222a52] text-[#e9edef]"} ${e.source === "painel_falhou" ? "!bg-rose-900/50" : ""}`}>
                    {(e.source === "painel_falhou" || ["hermes_v4", "secretario", "secretaria"].includes(e.source)) && <p className="mb-1 text-[10px] font-medium text-white/50">{SOURCE[e.source] ?? who(e)}</p>}
                    {e.media === "audio" ? (
                      e.external_id && audioIds.has(e.external_id) ? <div className="flex items-center gap-2">
                        <audio controls preload="none" className="h-10 w-56 max-w-full" src={`/api/conversas/audio/${encodeURIComponent(e.external_id)}`} />
                        <a href={`/api/conversas/audio/${encodeURIComponent(e.external_id)}?baixar=1`} download title="Baixar áudio" aria-label="Baixar áudio" className="btn-ghost shrink-0 px-2 py-1 text-sm">⬇</a>
                      </div> : <p className="text-sm text-muted">🎤 Áudio (arquivo não disponível)</p>
                    ) : ["video", "imagem", "arquivo"].includes(e.media) && e.source.startsWith("painel") ? <a className="block rounded-lg bg-black/10 p-3 text-sm underline" href={`/api/conversas/anexos/${e.id.replace(":painel", "")}`} target="_blank" rel="noopener noreferrer">{e.media === "video" ? "▶ Vídeo" : e.media === "imagem" ? "▧ Imagem" : "📎 Arquivo"} · {e.body}</a> : <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.55]">{textOf(e)}</p>}
                    <p className={`mt-1 text-right text-[10px] ${out ? "text-white/70" : "text-muted"}`}>{new Date(e.occurred_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}{out && e.source !== "simulacao" && <span title="A leitura depende da confirmação enviada pelo WhatsApp." className={`ml-2 ${e.receipt_ack != null && e.receipt_ack >= 3 ? "text-sky-300" : ""}`}>{e.source === "painel_falhou" ? "Falha no envio" : receiptLabel(e.receipt_ack)} {e.receipt_ack != null && e.receipt_ack >= 2 ? "✓✓" : e.receipt_ack === 1 ? "✓" : ""}</span>}</p>
                  </div>
                </div>
              </li>;
            })}
            <PendingBubbles />
            {visible.length === 0 && pendingInitial.length === 0 && <li className="py-8 text-center text-sm text-muted">Nenhuma mensagem registrada.</li>}
          </ol>
        </ChatScroll>
        {events.length === 300 && <p className="px-4 py-1 text-xs text-muted">Exibindo as últimas 300 mensagens.</p>}
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
          {diagnosis && <CopyResumo text={`${diagnosisText(diagnosis as Diagnosis)}

----------------------------------------

${copyText}`} label="📋 Copiar diagnóstico + conversa" />}
          <CopyResumo text={copyText} label="📋 Copiar conversa" />
          <Link href={`/leads/${current.id}`} className="btn-ghost">Ficha do lead</Link>
        </div>
      </section>
      <ContactNotes key={current.id} leadId={current.id} />
    </aside>
  ) : null;

  return (
    <>
      <ChatShell list={list} chat={chat} info={info} selected={!!sp.lead} selectedId={current?.id} />
    </>
  );
}
