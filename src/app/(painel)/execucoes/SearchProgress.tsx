import type { Report } from "./RunReport";

/** Progresso parcial do CRM: salvar um candidato não comprova o filtro da OBS. */
export function SearchProgress({ target, report }: { target: number; report?: Report }) {
  if (!report) return <span role="status" className="mt-2 block text-xs text-amber-300">Pesquisa em andamento. Progresso temporariamente indisponível; a busca pode continuar no PC.</span>;
  const percent = Math.min(100, Math.max(0, target > 0 ? Math.round(report.saved / target * 100) : 0));
  return <span className="mt-2 block max-w-xl space-y-2">
    <span className="flex flex-wrap gap-2 text-xs">
      <span className="rounded bg-emerald-400/10 px-2 py-1 text-emerald-300"><b>{report.saved} de {target}</b> leads cadastrados</span>
      <span className="rounded bg-amber-400/10 px-2 py-1 text-amber-200"><b>{report.pending_enrichment}</b> precisam de enriquecimento</span>
      {report.pending_review > 0 && <span className="rounded bg-amber-400/10 px-2 py-1 text-amber-200"><b>{report.pending_review}</b> duplicidades para revisar</span>}
    </span>
    <span role="progressbar" aria-label="Leads cadastrados nesta pesquisa" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(report.saved, target)} aria-valuetext={`${report.saved} de ${target} leads cadastrados`} className="block h-2 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${percent}%` }} /></span>
    <span className="block text-xs text-muted">Atualiza automaticamente enquanto esta aba estiver visível. Cadastrado não significa que a OBS foi confirmada: bio bloqueada, links não verificados e dados incompletos ficam como pendência. Os totais de buscas, descartes e erros são consolidados ao terminar.</span>
  </span>;
}
