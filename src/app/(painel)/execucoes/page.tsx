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
        title="Pesquisas do Hermes"
        subtitle="Cada vez que o Hermes pesquisou: quantas buscas fez, quantos leads cadastrou e por que parou."
      />
      {error ? (
        <ErrorBox message={dbErrorMessage(error)} />
      ) : !data?.length ? (
        <Empty title="Nenhuma execução registrada.">
          Rode a pesquisa manual descrita no README para validar a integração.
        </Empty>
      ) : (
        <>
        {/* Celular: um cartão por pesquisa. */}
        <ul className="space-y-2 md:hidden">
          {data.map((r) => (
            <li key={r.id} className="card p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs text-muted">
                  {fmtDateTime(r.started_at)}
                  {r.finished_at && <> até {fmtDateTime(r.finished_at)}</>}
                </div>
                <span className={`shrink-0 text-xs font-medium ${statusColor(r.status)}`}>{RUN_STATUS_LABEL[r.status] ?? r.status}</span>
              </div>
              <dl className="mt-2 grid grid-cols-4 gap-2 text-center">
                {([
                  ["Pesquis.", r.searched],
                  ["Aprov.", r.approved],
                  ["Criados", r.created],
                  ["Já exist.", r.existing],
                  ["Dupl.?", r.possible_duplicates],
                  ["Descart.", r.discarded],
                  ["Inválid.", r.invalid],
                  ["Erros", r.errors],
                ] as [string, number][]).map(([label, v]) => (
                  <div key={label} className="rounded-lg bg-panel-2 px-1 py-1.5">
                    <dd className="font-semibold tabular-nums">{v}</dd>
                    <dt className="text-[10px] text-muted">{label}</dt>
                  </div>
                ))}
              </dl>
              {r.end_reason && <p className="mt-2 break-words text-sm">{r.end_reason}</p>}
              {Array.isArray(r.error_details) && r.error_details.length > 0 && (
                <details className="mt-1 text-xs text-rose-300">
                  <summary className="cursor-pointer">Erros</summary>
                  <ul className="list-disc break-words pl-4">
                    {(r.error_details as string[]).map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
              {r.notes && <p className="mt-1 break-words text-xs text-muted">{r.notes}</p>}
            </li>
          ))}
        </ul>

        <div className="card hidden overflow-x-auto md:block">
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
                    <span className={statusColor(r.status)}>
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
        </>
      )}
    </>
  );
}

function statusColor(status: string) {
  return status === "falhou" || status === "abandonada" ? "text-rose-300" : status === "em_andamento" ? "text-amber-300" : "text-emerald-300";
}
