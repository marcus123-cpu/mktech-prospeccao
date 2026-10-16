import Link from "next/link";
import { ErrorBox, Fold, PageHeader } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { fmtDateTime, haQuanto } from "@/lib/time";
import { ArchiveButton } from "./Archive";
import { ClearPriceButton } from "./ClearPrice";

export const metadata = { title: "Funil" };
export const dynamic = "force-dynamic";

type Card = {
  id: string;
  business_name: string;
  city: string;
  fit_score: number | null;
  coluna: string | null;
  movido_em: string | null;
  last_reply: string | null;
  last_reply_kind: "automatica" | "humana" | null;
  last_reply_at: string | null;
  greeting_sent_at: string | null;
  sent_at: string | null;
  sent_audio: boolean;
};

// Só mostra. A conversa com o cliente é sempre sua; o Hermes só manda a saudação.
// Colunas parecidas ficam juntas para o quadro ser curto; as vazias (fora as principais) somem.
const COLUMNS = [
  { key: "fila", keys: ["fila"], title: "⏳ Na fila", hint: "saudação pronta, aguardando a vez", dot: "bg-slate-400", core: false },
  { key: "enviado", keys: ["enviado"], title: "📤 Saudação enviada", hint: "aguardando resposta", dot: "bg-indigo-400", core: true },
  { key: "aguardando", keys: ["aguardando"], title: "🕐 Resposta automática", hint: "a clínica respondeu por robô: espere uma pessoa", dot: "bg-cyan-400", core: false },
  { key: "conversa", keys: ["conversa", "valor"], title: "💬 Responderam", hint: "uma pessoa respondeu: é com você", dot: "bg-sky-400", core: true },
  { key: "fechando", keys: ["fechando"], title: "🤝 Fechando", hint: "proposta ou negociação", dot: "bg-violet-400", core: false },
  { key: "fechado", keys: ["fechado"], title: "🎉 Fechado", hint: "venda fechada", dot: "bg-emerald-400", core: false },
  { key: "sem_resposta", keys: ["sem_resposta", "lembrando", "sem_retorno"], title: "😶 Sem resposta", hint: "ninguém respondeu", dot: "bg-zinc-400", core: false },
  { key: "encerrado", keys: ["encerrado"], title: "🚫 Encerrados", hint: "sem interesse ou não contatar", dot: "bg-stone-500", core: false },
] as const;

export default async function FunilPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("outreach_funnel")
    .select("id, business_name, city, fit_score, coluna, movido_em, last_reply, last_reply_kind, last_reply_at, greeting_sent_at, sent_at, sent_audio")
    .order("movido_em", { ascending: false })
    .limit(600);
  const cards = (data ?? []) as Card[];
  const archived = cards.filter((c) => c.coluna === "arquivado");
  const attention = cards.filter((c) => c.coluna === "atencao").length;
  // Quem respondeu e está esperando você, do mais antigo (mais urgente) ao mais novo.
  const waiting = cards
    .filter((c) => (c.coluna === "conversa" || c.coluna === "valor") && c.last_reply_at && (!c.sent_at || new Date(c.last_reply_at).getTime() > new Date(c.sent_at).getTime()))
    .sort((a, b) => new Date(a.last_reply_at as string).getTime() - new Date(b.last_reply_at as string).getTime());

  return (
    <>
      <PageHeader
        title="🎯 Funil"
        subtitle="Do envio da saudação até o fechamento, tudo em um quadro só."
        actions={<><Link href="/disparo" className="btn-ghost">📤 Disparar</Link><Link href="/conversas" className="btn-primary">💬 Conversas</Link></>}
      />
      {error ? (
        <ErrorBox message={dbErrorMessage(error)} />
      ) : (
        <>
          {waiting.length > 0 && (
            <div className="mb-4 rounded-lg border border-sky-700 bg-sky-950/50 p-3 text-sm text-sky-100">
              <p className="font-semibold">
                {waiting.length === 1 ? "1 cliente respondeu e espera você" : `${waiting.length} clientes responderam e esperam você`}
              </p>
              <ul className="mt-2 space-y-1">
                {waiting.slice(0, 8).map((c) => (
                  <li key={c.id}>
                    <Link href={`/leads/${c.id}`} className="underline">{c.business_name}</Link>
                    <span className="text-sky-300"> · respondeu {haQuanto(c.last_reply_at)}</span>
                    {c.coluna === "valor" && <span className="text-amber-300"> · perguntou valor</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {attention > 0 && (
            <p className="mb-4 rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">
              {attention} envio(s) precisam de verificação.{" "}
              <Link href="/disparo" className="underline">Ir para Disparar</Link>
            </p>
          )}
          {/* Resumo: um número por etapa; no celular rola para o lado e leva à coluna. */}
          <nav aria-label="Resumo do funil" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
            {COLUMNS.map((col) => {
              const n = cards.filter((c) => (col.keys as readonly string[]).includes(c.coluna ?? "")).length;
              return (
                <a key={col.key} href={`#${col.key}`} className={`flex shrink-0 items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs ${n > 0 ? "bg-panel text-slate-100" : "text-muted"}`}>
                  <span className={`h-2 w-2 rounded-full ${col.dot}`} />{col.title.replace(/^\S+\s/, "")}<b>{n}</b>
                </a>
              );
            })}
          </nav>
          <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-3">
            {COLUMNS.map((col) => {
              const items = cards.filter((c) => (col.keys as readonly string[]).includes(c.coluna ?? ""));
              if (items.length === 0 && !col.core) return null;
              const talk = col.key === "conversa";
              return (
                <section key={col.key} id={col.key} aria-label={col.title} className="card w-[84vw] max-w-sm shrink-0 snap-start p-4 md:w-auto md:max-w-none">
                  <h2 className="flex items-center justify-between text-sm font-semibold">
                    <span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />{col.title}</span>
                    <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs font-normal text-muted">{items.length}</span>
                  </h2>
                  <p className="mb-3 mt-1 text-xs text-muted">{col.hint}</p>
                  <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                    {items.slice(0, 50).map((c) => (
                      <li key={c.id} className="rounded-xl border border-line bg-panel-2/60 p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <Link href={`/conversas?lead=${c.id}`} className="min-w-0 truncate font-medium hover:underline">{c.business_name}</Link>
                          {c.coluna === "valor" && <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200">💰 valor</span>}
                        </div>
                        <p className="text-xs text-muted">{c.city}{c.fit_score !== null && ` · nota ${c.fit_score}`}</p>
                        {c.sent_audio && talk && <p className="mt-2 rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-200">🎤 Mandou áudio</p>}
                        {c.last_reply && talk && <p className="mt-2 line-clamp-3 rounded-lg bg-panel px-2.5 py-1.5 text-xs text-slate-300">“{c.last_reply}”</p>}
                        <p className="mt-2 text-[11px] text-muted">
                          {c.last_reply_at && talk
                            ? `respondeu ${haQuanto(c.last_reply_at)}`
                            : c.sent_at ? `enviada ${fmtDateTime(c.sent_at)}`
                            : c.greeting_sent_at ? `saudação ${fmtDateTime(c.greeting_sent_at)}`
                            : c.movido_em ? fmtDateTime(c.movido_em) : ""}
                        </p>
                        {c.coluna === "valor" && <ClearPriceButton id={c.id} />}
                        <ArchiveButton id={c.id} name={c.business_name} archived={false} />
                      </li>
                    ))}
                    {items.length > 50 && <li className="text-xs text-muted">e mais {items.length - 50}…</li>}
                    {items.length === 0 && <li className="py-3 text-center text-xs text-muted">Nada aqui ainda.</li>}
                  </ul>
                </section>
              );
            })}
          </div>
          {archived.length > 0 && (
            <Fold title="🗄️ Arquivados" count={archived.length} hint="tirados do funil por você; nada foi apagado">
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {archived.slice(0, 100).map((c) => (
                  <li key={c.id} className="rounded-lg bg-panel-2 p-3 text-sm">
                    <Link href={`/leads/${c.id}`} className="font-medium hover:underline">{c.business_name}</Link>
                    <div className="text-xs text-muted">{c.city}</div>
                    <ArchiveButton id={c.id} name={c.business_name} archived />
                  </li>
                ))}
              </ul>
            </Fold>
          )}
        </>
      )}
    </>
  );
}
