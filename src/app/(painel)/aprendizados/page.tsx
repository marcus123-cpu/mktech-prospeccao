import { ActionForm } from "@/components/ActionForm";
import { ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { fmtDateTime } from "@/lib/time";
import { addLearning, decideLearning } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aprendizados" };

type Learning = { id: string; lesson: string; status: "pendente" | "ativa" | "recusada"; source: "hermes" | "manual"; created_at: string };

export default async function AprendizadosPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("admin_learnings_list");
  if (error) return <><PageHeader title="Aprendizados" /><ErrorBox message="Não foi possível carregar. Aplique a migração 20261015160000_aprendizados.sql no Supabase." /></>;
  const all = (data ?? []) as Learning[];
  const by = (s: Learning["status"]) => all.filter((l) => l.status === s);
  const btn = (l: Learning, status: string, label: string, variant = "btn-ghost") =>
    <ActionForm action={decideLearning} submit={label} variant={variant} className="space-y-0"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value={status} /></ActionForm>;

  return <>
    <PageHeader title="🧠 Aprendizados do Hermes" subtitle="A cada conversa o Hermes anota o que aprendeu. Você aprova o que vale: só o aprovado passa a valer nas próximas conversas." />

    <section className="card mb-4 p-4">
      <h2 className="mb-2 font-semibold">Ensinar algo ao Hermes</h2>
      <ActionForm action={addLearning} submit="Ensinar" className="space-y-2">
        <textarea name="lesson" rows={2} maxLength={300} className="input w-full" placeholder="Ex.: Quando a pessoa perguntar preço logo de cara, responda curto e pergunte o que ela precisa antes de falar de valores." />
      </ActionForm>
    </section>

    <section className="card mb-4 p-4">
      <h2 className="mb-2 font-semibold">Para você aprovar ({by("pendente").length})</h2>
      {by("pendente").length === 0 ? <p className="text-sm text-muted">Nada novo. As sugestões aparecem aqui depois das conversas.</p> : <ul className="divide-y divide-white/10 text-sm">
        {by("pendente").map((l) => <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="max-w-3xl">{l.lesson} <span className="text-xs text-muted">· {fmtDateTime(l.created_at)}</span></span>
          <span className="flex gap-2">{btn(l, "ativa", "✅ Aprovar", "btn-primary")}{btn(l, "recusada", "Recusar")}</span>
        </li>)}
      </ul>}
    </section>

    <section className="card p-4">
      <h2 className="mb-2 font-semibold">Valendo agora ({by("ativa").length}/20)</h2>
      {by("ativa").length === 0 ? <p className="text-sm text-muted">Nenhum ainda.</p> : <ul className="divide-y divide-white/10 text-sm">
        {by("ativa").map((l) => <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="max-w-3xl">{l.lesson} <span className="text-xs text-muted">· {l.source === "manual" ? "você ensinou" : "o Hermes sugeriu"}</span></span>
          {btn(l, "recusada", "Parar de usar")}
        </li>)}
      </ul>}
    </section>
  </>;
}
