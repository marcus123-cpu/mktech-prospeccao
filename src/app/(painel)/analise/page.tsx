import Link from "next/link";
import { ErrorBox, PageHeader, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { dicas, duracao, pct, type Analise, type Linha } from "@/lib/analysis";
import { fmtDateTime, todaySP } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Análise" };

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const label = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;
const shift = (ym: string, by: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + by, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const range = (ym: string) => ({ p_from: `${ym}-01T00:00:00-03:00`, p_to: `${shift(ym, 1)}-01T00:00:00-03:00` });

const SITUACOES: { key: string; titulo: string; dica: string; tom: string }[] = [
  { key: "sem_resposta_silencio", titulo: "Não responderam ao quebra-gelo (silêncio)", dica: "Passaram mais de 48h e nem resposta automática veio", tom: "bg-rose-500" },
  { key: "sem_resposta_so_automatica", titulo: "Só resposta automática do WhatsApp Business", dica: "Ninguém de verdade falou depois", tom: "bg-orange-500" },
  { key: "aguardando_cliente_recente", titulo: "Quebra-gelo enviado há menos de 48h", dica: "Ainda é cedo para dizer", tom: "bg-slate-500" },
  { key: "respondeu_sem_apresentacao", titulo: "Responderam e você ainda não seguiu a conversa", dica: "Estão esperando você", tom: "bg-amber-500" },
  { key: "aguardando_voce", titulo: "A última mensagem é do cliente (sua vez)", dica: "Responda estes primeiro", tom: "bg-amber-400" },
  { key: "parou_apos_apresentacao", titulo: "Pararam depois da apresentação", dica: "Você falou e eles não voltaram", tom: "bg-rose-400" },
  { key: "aguardando_cliente_apresentacao", titulo: "Apresentação enviada há menos de 48h", dica: "Ainda é cedo para dizer", tom: "bg-slate-500" },
  { key: "esfriou_na_conversa", titulo: "A conversa esfriou", dica: "Havia conversa e ninguém falou há mais de 3 dias", tom: "bg-yellow-500" },
  { key: "em_andamento", titulo: "Conversa em andamento", dica: "Está fluindo", tom: "bg-emerald-500" },
  { key: "proposta", titulo: "Proposta enviada", dica: "", tom: "bg-sky-500" },
  { key: "fechado", titulo: "Fechado", dica: "", tom: "bg-emerald-400" },
  { key: "recusou", titulo: "Pediram para parar / sem interesse", dica: "", tom: "bg-slate-600" },
];

function Taxa({ l }: { l: Linha }) {
  const t = pct(l.responderam, l.enviados);
  return <tr className="border-t border-line/60">
    <td className="py-2 pr-3 text-sm">{l.nome}{l.enviados < 8 && <span className="ml-2 text-[10px] text-muted">(poucos dados)</span>}</td>
    <td className="py-2 pr-3 text-right text-sm tabular-nums text-muted">{l.enviados}</td>
    <td className="py-2 pr-3 text-right text-sm tabular-nums">{l.responderam}</td>
    <td className="w-40 py-2"><div className="flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-accent" style={{ width: `${t}%` }} /></div><span className="w-9 text-right text-xs font-semibold tabular-nums">{t}%</span></div></td>
  </tr>;
}
function Tabela({ titulo, linhas }: { titulo: string; linhas: Linha[] }) {
  if (!linhas.length) return null;
  return <section className="card p-5"><h3 className="mb-2 font-semibold">{titulo}</h3>
    <table className="w-full"><thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted"><th className="pb-1 font-medium">&nbsp;</th><th className="pb-1 text-right font-medium">Enviados</th><th className="pb-1 text-right font-medium">Respostas</th><th className="pb-1 pl-2 font-medium">Taxa</th></tr></thead>
      <tbody>{linhas.map(l => <Taxa key={l.nome} l={l} />)}</tbody></table></section>;
}

export default async function AnalisePage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const hoje = todaySP().slice(0, 7);
  const mes = sp.mes && /^20\d\d-(0[1-9]|1[0-2])$/.test(sp.mes) && sp.mes <= hoje ? sp.mes : hoje;
  const { supabase } = await requireAdmin();
  const [cur, prev] = await Promise.all([supabase.rpc("admin_analysis", range(mes)), supabase.rpc("admin_analysis", range(shift(mes, -1)))]);
  if (cur.error || !cur.data) return <><PageHeader title="Análise" /><ErrorBox message="Não foi possível carregar a análise. Tente novamente em instantes." /></>;
  const a = cur.data as Analise;
  const antes = prev.error ? null : (prev.data as Analise);
  const f = a.funil;
  const meses = Array.from({ length: 6 }, (_, i) => shift(hoje, -i));
  const taxa1 = pct(f.responderam, f.quebra_gelo);
  const taxa1Ant = antes && antes.funil.quebra_gelo >= 10 ? pct(antes.funil.responderam, antes.funil.quebra_gelo) : null;
  const taxa2 = pct(f.responderam_apresentacao, f.apresentacao);
  const etapas = [
    { nome: "Quebra-gelo enviado", n: f.quebra_gelo },
    { nome: "Uma pessoa respondeu", n: f.responderam },
    { nome: "Você seguiu a conversa (apresentação)", n: f.apresentacao },
    { nome: "Continuaram depois da apresentação", n: f.responderam_apresentacao },
    { nome: "Proposta enviada", n: f.proposta },
    { nome: "Fechado", n: f.fechado },
  ];
  const t = a.tempo_voce;
  const faixas = [
    { nome: "Até 5 minutos", n: t.ate_5min, cor: "bg-emerald-500" },
    { nome: "De 5 min a 1 hora", n: t.ate_1h - t.ate_5min, cor: "bg-sky-500" },
    { nome: "De 1 hora a 1 dia", n: t.ate_24h - t.ate_1h, cor: "bg-amber-500" },
    { nome: "Mais de 1 dia", n: t.mais_de_24h, cor: "bg-rose-500" },
  ];
  const conselhos = dicas(a, antes);
  const tomCor = { ruim: "border-rose-500/40 bg-rose-500/10", atencao: "border-amber-500/40 bg-amber-500/10", bom: "border-emerald-500/40 bg-emerald-500/10" } as const;
  const tomIcone = { ruim: "🔻", atencao: "⚠️", bom: "✅" } as const;
  const exemplos = (k: string) => a.exemplos[k] ?? [];

  return <>
    <PageHeader title="📈 Análise" subtitle="Onde a prospecção está falhando: em que ponto o cliente para de responder e quanto tempo você leva para responder. Atualizada automaticamente." />

    <nav aria-label="Mês" className="mb-5 flex flex-wrap gap-2">
      {meses.map(m => <Link key={m} href={`/analise?mes=${m}`} aria-current={m === mes ? "page" : undefined} className={m === mes ? "btn-primary" : "btn-ghost"}>{m === hoje ? "Este mês" : label(m).split(" de ")[0]}</Link>)}
    </nav>
    <p className="mb-4 text-sm text-muted">Mostrando <b className="text-slate-200">{label(mes)}</b>. Conta os leads cujo primeiro quebra-gelo saiu neste mês{antes && antes.funil.quebra_gelo > 0 ? " e compara com o mês anterior" : ""}. Contatos que vieram do seu WhatsApp pessoal não entram.</p>

    <div className="stagger mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat highlight label="Quebra-gelos enviados" value={f.quebra_gelo} hint={antes ? `mês passado: ${antes.funil.quebra_gelo}` : undefined} />
      <Stat label="Pessoas responderam" value={`${taxa1}%`} hint={taxa1Ant === null ? `${f.responderam} de ${f.quebra_gelo}` : `${f.responderam} de ${f.quebra_gelo} · mês passado ${taxa1Ant}%`} />
      <Stat label="Continuaram após apresentação" value={f.apresentacao ? `${taxa2}%` : "—"} hint={`${f.responderam_apresentacao} de ${f.apresentacao}`} />
      <Stat label="Você responde em (mediana)" value={duracao(t.mediana_min)} hint={t.respondidas ? `90% em até ${duracao(t.p90_min)}` : "sem respostas no mês"} />
      <Stat label="Esperando você agora" value={a.sem_resposta_agora.n} hint={a.sem_resposta_agora.n ? `a mais antiga há ${duracao((a.sem_resposta_agora.mais_antiga_horas ?? 0) * 60)}` : "tudo respondido"} />
    </div>

    {conselhos.length > 0 && <section className="mb-6">
      <h2 className="mb-3 text-lg font-semibold">O que fazer para melhorar</h2>
      <div className="grid gap-3 md:grid-cols-2">{conselhos.map((d, i) => <article key={i} className={`rounded-2xl border p-4 ${tomCor[d.tom]}`}>
        <p className="font-semibold">{tomIcone[d.tom]} {d.titulo}</p><p className="mt-1 text-sm text-slate-300">{d.texto}</p></article>)}</div>
    </section>}

    <section className="card mb-6 p-5">
      <h2 className="mb-1 text-lg font-semibold">Funil: onde o cliente desiste</h2>
      <p className="mb-4 text-sm text-muted">Cada barra mostra quantos chegaram naquela etapa, em relação aos quebra-gelos enviados.</p>
      <ol className="space-y-3">
        {etapas.map((e, i) => {
          const anterior = i > 0 ? etapas[i - 1].n : null;
          const perdeu = anterior !== null ? anterior - e.n : 0;
          return <li key={e.nome}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm"><span className="font-medium">{e.nome}</span>
              <span className="tabular-nums"><b>{e.n}</b> <span className="text-muted">({pct(e.n, f.quebra_gelo)}% do total)</span>{anterior !== null && perdeu > 0 && <span className="ml-2 text-rose-300">−{perdeu} nesta etapa ({pct(perdeu, anterior)}%)</span>}</span></div>
            <div className="h-3 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${i === 0 ? "bg-accent" : "bg-gradient-to-r from-accent to-accent-2"}`} style={{ width: `${Math.max(pct(e.n, f.quebra_gelo), e.n ? 2 : 0)}%` }} /></div>
          </li>;
        })}
      </ol>
      {f.so_automatica > 0 && <p className="mt-4 text-xs text-muted">Dos que não responderam, {f.so_automatica} receberam só uma resposta automática do WhatsApp Business (não conta como pessoa).</p>}
    </section>

    <section className="card mb-6 p-5">
      <h2 className="mb-1 text-lg font-semibold">Para onde foi cada lead</h2>
      <p className="mb-4 text-sm text-muted">Todos os {f.quebra_gelo} leads do mês, cada um em uma situação só.</p>
      <ul className="space-y-2">
        {SITUACOES.filter(s => (a.situacoes[s.key] ?? 0) > 0).map(s => { const n = a.situacoes[s.key]; return <li key={s.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="min-w-0"><p className="truncate text-sm font-medium">{s.titulo}</p>{s.dica && <p className="truncate text-[11px] text-muted">{s.dica}</p>}</div>
          <div className="order-last col-span-2 h-2.5 overflow-hidden rounded-full bg-white/10 sm:order-none sm:col-span-1"><div className={`h-full rounded-full ${s.tom}`} style={{ width: `${pct(n, f.quebra_gelo)}%` }} /></div>
          <span className="text-right text-sm tabular-nums"><b>{n}</b> <span className="text-muted">{pct(n, f.quebra_gelo)}%</span></span></li>; })}
      </ul>
    </section>

    {(["aguardando_voce", "respondeu_sem_apresentacao", "parou_apos_apresentacao", "esfriou_na_conversa"] as const).some(k => exemplos(k).length) && <section className="mb-6 grid gap-3 lg:grid-cols-2">
      {([["aguardando_voce", "Esperando a sua resposta", "Responda estes primeiro"], ["respondeu_sem_apresentacao", "Responderam e ainda sem seguimento", "Eles já abriram a conversa"], ["parou_apos_apresentacao", "Pararam depois da apresentação", "Candidatos a um segundo contato"], ["esfriou_na_conversa", "Conversas que esfriaram", "Retome com algo novo"]] as const).map(([k, titulo, sub]) => exemplos(k).length > 0 && <div key={k} className="card p-4">
        <h3 className="font-semibold">{titulo} <span className="badge bg-white/10 text-slate-300">{a.situacoes[k] ?? exemplos(k).length}</span></h3><p className="mb-2 text-xs text-muted">{sub}</p>
        <ul className="divide-y divide-line/60 text-sm">{exemplos(k).map(e => <li key={e.id} className="flex items-center justify-between gap-3 py-2"><Link className="min-w-0 truncate hover:underline" href={`/conversas?lead=${e.id}`}>{e.nome}</Link><span className="shrink-0 text-xs text-muted">{fmtDateTime(e.desde)}</span></li>)}</ul>
        {(a.situacoes[k] ?? 0) > exemplos(k).length && <p className="mt-2 text-xs text-muted">e mais {(a.situacoes[k] ?? 0) - exemplos(k).length}…</p>}</div>)}
    </section>}

    <section className="card mb-6 p-5">
      <h2 className="mb-1 text-lg font-semibold">Quanto tempo você demora para responder</h2>
      <p className="mb-4 text-sm text-muted">Conta cada vez que um cliente escreveu e você respondeu depois.{a.tempo_cliente_quebra_gelo.n > 0 && <> O cliente leva em mediana <b className="text-slate-200">{duracao(a.tempo_cliente_quebra_gelo.mediana_min)}</b> para responder ao quebra-gelo.</>}</p>
      {t.respondidas === 0 ? <p className="text-sm text-muted">Ainda não há respostas suas neste mês.</p> : <ul className="space-y-3">
        {faixas.map(x => <li key={x.nome}><div className="mb-1 flex justify-between text-sm"><span>{x.nome}</span><span className="tabular-nums"><b>{x.n}</b> <span className="text-muted">({pct(x.n, t.respondidas)}%)</span></span></div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${x.cor}`} style={{ width: `${pct(x.n, t.respondidas)}%` }} /></div></li>)}
      </ul>}
      {a.resposta_rapida.rapido_n + a.resposta_rapida.lento_n > 0 && <p className="mt-4 text-sm text-muted">Quando você respondeu em até 1h, <b className="text-slate-200">{pct(a.resposta_rapida.rapido_continuou, a.resposta_rapida.rapido_n)}%</b> continuaram a conversa ({a.resposta_rapida.rapido_continuou} de {a.resposta_rapida.rapido_n}). Quando demorou mais, <b className="text-slate-200">{a.resposta_rapida.lento_n ? `${pct(a.resposta_rapida.lento_continuou, a.resposta_rapida.lento_n)}%` : "—"}</b> ({a.resposta_rapida.lento_continuou} de {a.resposta_rapida.lento_n}).</p>}
    </section>

    <h2 className="mb-3 text-lg font-semibold">O que está funcionando melhor</h2>
    <p className="mb-3 text-sm text-muted">Taxa de resposta de pessoas ao quebra-gelo, por grupo. Grupos com menos de 8 envios têm poucos dados para concluir algo.</p>
    <div className="mb-8 grid gap-3 lg:grid-cols-2">
      <Tabela titulo="Por nicho" linhas={a.por_nicho} />
      <Tabela titulo="Por dia da semana" linhas={a.por_dia} />
      <Tabela titulo="Por horário do envio" linhas={a.por_horario} />
      <Tabela titulo="Por estratégia de mensagem" linhas={[...a.por_estrategia, ...a.por_estilo]} />
    </div>
  </>;
}
