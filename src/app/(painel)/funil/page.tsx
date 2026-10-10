import Link from "next/link";
import { ErrorBox, PageHeader } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { fmtDateTime, haQuanto } from "@/lib/time";
import { SwitchControls, type OutreachSettings } from "../envio/Forms";
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

// Só mostra. Mover um lead entre colunas é feito na ficha (etapa, proposta,
// fechamento); a resposta ao cliente é sempre sua.
const COLUMNS = [
  { key: "fila", title: "Na fila", hint: "mensagem pronta, aguardando a vez", tone: "border-slate-600" },
  { key: "enviado", title: "Enviado", hint: "aguardando resposta", tone: "border-indigo-700" },
  { key: "aguardando", title: "Aguardando humano", hint: "resposta automática: o texto só sai quando uma pessoa escrever", tone: "border-cyan-700" },
  { key: "sem_resposta", title: "Sem resposta", hint: "2 dias úteis sem pessoa responder: nada é enviado sozinho", tone: "border-zinc-600" },
  { key: "conversa", title: "Em conversa", hint: "uma pessoa respondeu: é com você", tone: "border-sky-600" },
  { key: "valor", title: "Pergunta de valor", hint: "perguntou preço: responda você", tone: "border-amber-500" },
  { key: "fechando", title: "Fechando", hint: "proposta enviada", tone: "border-violet-600" },
  { key: "fechado", title: "Fechado", hint: "venda fechada", tone: "border-emerald-600" },
] as const;

export default async function FunilPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("outreach_funnel")
    .select("id, business_name, city, fit_score, coluna, movido_em, last_reply, last_reply_kind, last_reply_at, greeting_sent_at, sent_at, sent_audio")
    .order("movido_em", { ascending: false })
    .limit(600);
  const { data: bot } = await supabase.from("outreach_settings").select("*").eq("id", 1).maybeSingle();
  const cards = (data ?? []) as Card[];
  const attention = cards.filter((c) => c.coluna === "atencao").length;
  // Quem respondeu e está esperando você, do mais antigo (mais urgente) ao mais novo.
  const waiting = cards
    .filter((c) => (c.coluna === "conversa" || c.coluna === "valor") && c.last_reply_at)
    .sort((a, b) => new Date(a.last_reply_at as string).getTime() - new Date(b.last_reply_at as string).getTime());

  return (
    <>
      <PageHeader
        title="Funil"
        subtitle="Onde está cada lead do envio automático. O sistema nunca responde o cliente: quando alguém responde ou pergunta valor, a conversa é sua."
      />
      {bot && (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="text-sm">
            <span className="font-medium">Bot de WhatsApp: </span>
            {!bot.enabled ? "desligado" : bot.paused ? "pausado" : "ligado"}
            <span className="block text-xs text-muted">Mesma chave da tela Envio automático.</span>
          </div>
          <SwitchControls s={bot as OutreachSettings} />
        </div>
      )}
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
              {attention} envio(s) falharam.{" "}
              <Link href="/envio" className="underline">Ver em Envio automático</Link>
            </p>
          )}
          {/* No celular as colunas deslizam para o lado; estes atalhos levam direto a cada uma. */}
          <nav aria-label="Colunas" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 md:hidden">
            {COLUMNS.map((col) => {
              const n = cards.filter((c) => c.coluna === col.key).length;
              return (
                <a
                  key={col.key}
                  href={`#${col.key}`}
                  className={`badge shrink-0 py-1 ${col.key === "valor" && n > 0 ? "bg-amber-500/20 text-amber-200" : "bg-panel-2 text-slate-300"}`}
                >
                  {col.title} {n}
                </a>
              );
            })}
          </nav>
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 xl:grid-cols-4 2xl:grid-cols-8">
            {COLUMNS.map((col) => {
              const items = cards.filter((c) => c.coluna === col.key);
              return (
                <section
                  key={col.key}
                  id={col.key}
                  aria-label={col.title}
                  className={`card w-[82vw] max-w-sm shrink-0 snap-start border-t-4 p-3 md:w-auto md:max-w-none ${col.tone}`}
                >
                  <h2 className="flex items-baseline justify-between text-sm font-semibold">
                    {col.title}
                    <span className="text-xs font-normal text-muted">{items.length}</span>
                  </h2>
                  <p className="mb-3 text-xs text-muted">{col.hint}</p>
                  <ul className="space-y-2">
                    {items.slice(0, 50).map((c) => (
                      <li key={c.id} className="rounded-lg bg-panel-2 p-3 text-sm">
                        <Link href={`/leads/${c.id}`} className="font-medium hover:underline">{c.business_name}</Link>
                        <div className="text-xs text-muted">
                          {c.city}
                          {c.fit_score !== null && ` · nota ${c.fit_score}`}
                        </div>
                        {c.sent_audio && (col.key === "conversa" || col.key === "valor") && (
                          <p className="mt-2 rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-200">Mandou áudio: mude o estilo da conversa</p>
                        )}
                        {c.last_reply && (col.key === "conversa" || col.key === "valor") && (
                          <p className="mt-2 line-clamp-3 text-xs text-slate-300">“{c.last_reply}”</p>
                        )}
                        <div className="mt-1 text-[11px] text-muted">
                          {c.last_reply_at && (col.key === "conversa" || col.key === "valor")
                            ? `respondeu ${fmtDateTime(c.last_reply_at)} (${haQuanto(c.last_reply_at)})`
                            : c.sent_at
                              ? `enviada ${fmtDateTime(c.sent_at)}`
                              : c.greeting_sent_at
                                ? `saudação ${fmtDateTime(c.greeting_sent_at)}`
                                : c.movido_em && fmtDateTime(c.movido_em)}
                        </div>
                        {col.key === "valor" && <ClearPriceButton id={c.id} />}
                      </li>
                    ))}
                    {items.length > 50 && <li className="text-xs text-muted">e mais {items.length - 50}…</li>}
                    {items.length === 0 && <li className="text-xs text-muted">Nada aqui.</li>}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
