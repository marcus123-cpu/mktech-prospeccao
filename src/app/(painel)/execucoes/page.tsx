import { SettingsForm } from "../configuracoes/Forms";
import { Empty, ErrorBox, PageHeader } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { RUN_STATUS_LABEL } from "@/lib/labels";
import { fmtDateTime } from "@/lib/time";
import { locationLabel } from "@/lib/research";
import { CancelSearchButton, InterruptSearchButton, RequestSearchForm } from "./Pedido";
import { RunReport, type Report } from "./RunReport";
import { SearchProgress } from "./SearchProgress";

export const metadata = { title: "Execuções do Hermes" };
export const dynamic = "force-dynamic";

const PEDIDO_LABEL: Record<string, string> = {
  pendente: "esperando o PC chamar o Hermes",
  em_andamento: "o Hermes está buscando",
  concluido: "terminou",
  cancelado: "cancelado",
};

export default async function RunsPage() {
  const { supabase } = await requireAdmin();
  const settings = await supabase.from("prospecting_settings").select("*").eq("id", 1).maybeSingle();
  const { data, error } = await supabase
    .from("hermes_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(100);
  const { data: pedidos } = await supabase
    .from("hermes_requests")
    .select("id, qualified_target, max_searches, status, qualified_found, created_at, started_at, finished_at, note, observations, run_id, niche, location_scope, location_state, location_city")
    .order("created_at", { ascending: false })
    .limit(5);
  const aberto = (pedidos ?? []).find((p) => p.status === "pendente" || p.status === "em_andamento");
  const reports = new Map<string, Report>();
  await Promise.all((pedidos ?? []).filter((x) => x.run_id && (x.status === "em_andamento" || x.status === "concluido")).slice(0, 4).map(async p => {
    const r = await supabase.rpc("admin_run_report", { p_run: p.run_id });
    if (!r.error && r.data) reports.set(p.id, r.data as Report);
  }));

  return (
    <>
      <PageHeader
        title="🤖 Pesquisas do Hermes"
        subtitle="Cada vez que o Hermes pesquisou: quantas buscas fez, quantos leads cadastrou e por que parou."
      />
      <section className="card mb-4 p-4">
        <h2 className="mb-1 text-sm font-semibold">🔎 Nova pesquisa de leads</h2>
        <p className="mb-3 text-xs text-muted">
          Escolha o nicho, a localização e a meta de leads novos. Leads com nota baixa, telefone fixo ou dados incompletos também
          são salvos, para enriquecer depois. Pesquisar não envia mensagem para ninguém: disparo só começa quando você ativa uma
          campanha. O PC precisa estar ligado com o iniciar-tudo rodando.
        </p>
        <RequestSearchForm disabled={!!aberto} />
        {(pedidos?.length ?? 0) > 0 && (
          <ul className="mt-4 divide-y divide-line text-sm">
            {pedidos!.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{p.qualified_target} leads · {p.niche ?? "nicho das configurações"} · {locationLabel(p)}</span>
                  <span className="text-xs text-muted"> · pedido {fmtDateTime(p.created_at)} · {PEDIDO_LABEL[p.status] ?? p.status}</span>
                  {p.status === "concluido" && (
                    <span className={`text-xs ${(p.qualified_found ?? 0) >= p.qualified_target ? "text-emerald-300" : "text-amber-300"}`}>
                      {" "}· vieram {p.qualified_found ?? 0}
                    </span>
                  )}
                  {p.observations && <span className="mt-1 block text-xs text-accent">OBS: {p.observations}</span>}
                  {p.note && p.status === "concluido" && <span className="block text-xs text-muted">{p.note}</span>}
                  {p.status === "em_andamento" ? <SearchProgress target={p.qualified_target} report={reports.get(p.id)} /> : reports.get(p.id) && <RunReport report={reports.get(p.id)!} />}
                </span>
                {p.status === "pendente" && <CancelSearchButton id={p.id} />}
                {p.status === "em_andamento" && <InterruptSearchButton id={p.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
      <details className="card mb-4 p-4"><summary className="cursor-pointer font-semibold">Configurações da pesquisa automática</summary><div className="mt-4">{settings.data && <SettingsForm s={settings.data} />}</div></details>
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
