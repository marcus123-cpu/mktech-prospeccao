import { Empty, ErrorBox, PageHeader } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { RUN_STATUS_LABEL } from "@/lib/labels";
import { fmtDateTime } from "@/lib/time";

export const metadata = { title: "Execuções do Hermes" };

export default async function RunsPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("hermes_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(100);

  return (
    <>
      <PageHeader
        title="Execuções do Hermes"
        subtitle="Cada pesquisa registrada pelo Hermes. O painel só mostra o que o Hermes informou; ele não fica ligado por estar aqui."
      />
      {error ? (
        <ErrorBox message={dbErrorMessage(error)} />
      ) : !data?.length ? (
        <Empty title="Nenhuma execução registrada.">
          Rode a pesquisa manual descrita no README para validar a integração.
        </Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="border-b border-line">
              <tr>
                {["Início", "Término", "Situação", "Pesquisados", "Aprovados", "Criados", "Já existentes", "Possíveis dupl.", "Descartados", "Inválidos", "Erros", "Motivo do término"].map((h) => (
                  <th key={h} className="table-head">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="table-cell text-xs">{fmtDateTime(r.started_at)}</td>
                  <td className="table-cell text-xs">{fmtDateTime(r.finished_at)}</td>
                  <td className="table-cell">
                    <span className={r.status === "falhou" || r.status === "abandonada" ? "text-rose-300" : r.status === "em_andamento" ? "text-amber-300" : "text-emerald-300"}>
                      {RUN_STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  {[r.searched, r.approved, r.created, r.existing, r.possible_duplicates, r.discarded, r.invalid, r.errors].map((v, i) => (
                    <td key={i} className="table-cell tabular-nums">{v}</td>
                  ))}
                  <td className="table-cell text-sm">
                    {r.end_reason ?? "—"}
                    {Array.isArray(r.error_details) && r.error_details.length > 0 && (
                      <details className="mt-1 text-xs text-rose-300">
                        <summary className="cursor-pointer">Erros</summary>
                        <ul className="list-disc pl-4">
                          {(r.error_details as string[]).map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      </details>
                    )}
                    {r.notes && <p className="mt-1 text-xs text-muted">{r.notes}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
