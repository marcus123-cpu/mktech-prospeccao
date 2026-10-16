import { ActionForm } from "@/components/ActionForm";
import { CopyResumo } from "@/components/leads/CopyResumo";
import { ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { fmtDateTime } from "@/lib/time";
import { setStage, startApprenticeship, studyNow } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aprendizado" };

type Day = { day: string; notes: string; stats: Record<string, number>; updated_at: string };
type Data = {
  program: { status: "nao_iniciado" | "aprendendo" | "concluido" | "teste" | "aprovado"; started_on: string | null; study_requested_at: string | null; playbook: string; playbook_updated_at: string | null; final_report: string | null; final_report_at: string | null };
  day_number: number; total_days: number; days: Day[];
};
const STAT_LABELS: [string, string][] = [
  ["leads", "leads"], ["suas_mensagens_texto", "textos seus"], ["seus_audios", "áudios seus"], ["respostas_de_pessoas", "respostas de pessoas"], ["respostas_automaticas", "respostas automáticas"],
];
const fmtDay = (d: string) => new Date(`${d}T12:00:00-03:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });

export default async function AprendizadoPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("admin_apprenticeship_get");
  if (error || !data) return <><PageHeader title="Aprendizado" /><ErrorBox message="Não foi possível carregar. Aplique a migração 20261016090000_aprendizado_hermes.sql no Supabase." /></>;
  const d = data as Data;
  const p = d.program;
  const n = Math.min(d.day_number, d.total_days);
  const pct = Math.round((n / d.total_days) * 100);

  return <>
    <PageHeader title="🧠 Aprendizado do Hermes" subtitle="Durante 30 dias o Hermes estuda como você trabalha no WhatsApp: como abre, chama pelo nome, desenrola, trata robô, manda áudio. Só observa; nunca envia nada." />

    {p.status === "nao_iniciado" && <section className="card mb-4 p-6 text-center">
      <p className="text-4xl">🎓</p>
      <h2 className="mt-2 text-lg font-semibold">O Hermes ainda não começou a estudar</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted">Ao iniciar, todo dia ele lê as suas conversas (as mensagens que você manda pelo celular e as respostas dos clientes), anota o que aprendeu e atualiza o <b>aprendizado.md</b>. No dia 29 ele entrega o relatório final; depois vem o teste.</p>
      <div className="mt-4 flex justify-center"><ActionForm action={startApprenticeship} submit="▶️ Iniciar os 30 dias" className="space-y-0" confirmText="Começar o aprendizado agora? O dia 1 é hoje." /></div>
    </section>}

    {p.status !== "nao_iniciado" && <>
      <section className="card mb-4 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            {p.status === "aprendendo" && `Dia ${n} de ${d.total_days}`}
            {p.status === "concluido" && "✅ 30 dias de estudo concluídos"}
            {p.status === "teste" && "🧪 Em teste"}
            {p.status === "aprovado" && "🏆 Aprovado"}
          </h2>
          {p.status === "aprendendo" && <ActionForm action={studyNow} submit="📖 Estudar hoje agora" variant="btn-ghost" className="space-y-0" />}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-panel-2"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
        <p className="mt-2 text-xs text-muted">Começou em {p.started_on && fmtDay(p.started_on)}. O estudante precisa estar ligado no PC (o <b>TUDO.bat</b> liga). Ele anota cada dia à noite, a partir das 21h, e recupera os dias que ficaram para trás.</p>
        {p.study_requested_at && <p className="mt-1 text-xs text-amber-300">Pedido de estudo enviado: aguardando o PC.</p>}
      </section>

      {(p.status === "concluido" || p.status === "teste" || p.status === "aprovado") && <section className="card mb-4 p-4">
        <h2 className="mb-1 font-semibold">Próxima etapa: teste</h2>
        <p className="mb-3 text-sm text-muted">Quando você achar que ele está pronto, coloque-o em teste. Se passar, você o aprova para trabalhar por você. A parte que roda o teste e o trabalho 24h ainda será montada com o material destes 30 dias; aqui você só registra a etapa.</p>
        <div className="flex flex-wrap gap-2">
          {p.status === "concluido" && <ActionForm action={setStage} submit="🧪 Colocar em teste" className="space-y-0"><input type="hidden" name="status" value="teste" /></ActionForm>}
          {p.status === "teste" && <ActionForm action={setStage} submit="🏆 Aprovar" className="space-y-0" confirmText="Marcar o Hermes como aprovado?"><input type="hidden" name="status" value="aprovado" /></ActionForm>}
        </div>
      </section>}

      {p.final_report && <section className="card mb-4 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">📑 Relatório final {p.final_report_at && <span className="text-xs font-normal text-muted">· {fmtDateTime(p.final_report_at)}</span>}</h2>
          <CopyResumo text={p.final_report} label="Copiar relatório" /></div>
        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg bg-panel-2/60 p-3 text-sm">{p.final_report}</pre>
      </section>}

      <section className="card mb-4 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">📘 aprendizado.md {p.playbook_updated_at && <span className="text-xs font-normal text-muted">· atualizado {fmtDateTime(p.playbook_updated_at)}</span>}</h2>
          {p.playbook && <CopyResumo text={p.playbook} label="Copiar aprendizado.md" />}
        </div>
        {p.playbook ? <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg bg-panel-2/60 p-3 text-sm">{p.playbook}</pre>
          : <p className="text-sm text-muted">Vazio por enquanto. Aparece depois da primeira anotação diária. Uma cópia também fica no PC em <code>envio\aprendizado\aprendizado.md</code>.</p>}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">📓 Diário (dia a dia)</h2>
        {d.days.length === 0 ? <p className="text-sm text-muted">Nenhum dia anotado ainda.</p> : <ul className="space-y-2">
          {d.days.map((day) => <li key={day.day}><details className="rounded-xl border border-line bg-panel-2/40 p-3">
            <summary className="cursor-pointer text-sm font-medium">{fmtDay(day.day)}
              <span className="ml-2 text-xs font-normal text-muted">{STAT_LABELS.map(([k, l]) => `${day.stats?.[k] ?? 0} ${l}`).join(" · ")}</span></summary>
            <pre className="mt-3 whitespace-pre-wrap text-sm">{day.notes}</pre>
          </details></li>)}
        </ul>}
      </section>
    </>}

    <p className="mt-4 text-xs text-muted">Limites: os áudios não são transcritos; o Hermes anota quando e em que ponto da conversa você manda áudio, mas não o que você fala. Só aprende com conversas que passam pelo WhatsApp conectado aqui.</p>
  </>;
}
