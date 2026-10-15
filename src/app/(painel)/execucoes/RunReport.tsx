export type Report = {
  target: number | null; analyzed: number; saved: number; updated: number; pending_review: number; pending_enrichment: number; discarded: number; errors: number;
  discard_reasons: { reason: string; count: number }[]; shortfall: { missing: number; reason: string | null } | null;
};

/** Relatório da pesquisa: o que foi analisado, salvo, atualizado, pendente e descartado (com motivos). */
export function RunReport({ report: r }: { report: Report }) {
  const cell = (label: string, value: number) => <span className="rounded bg-black/20 px-2 py-0.5 text-xs">{label}: <b>{value}</b></span>;
  return (
    <span className="mt-1 block space-y-1">
      <span className="flex flex-wrap gap-1">
        {cell("analisadas", r.analyzed)}{cell("salvas", r.saved)}{cell("atualizadas", r.updated)}
        {cell("duplicidade a revisar", r.pending_review)}{cell("a enriquecer", r.pending_enrichment)}{cell("descartadas", r.discarded)}{cell("erros", r.errors)}
      </span>
      {r.shortfall && <span className="block text-xs text-amber-300">Faltaram {r.shortfall.missing} para a meta de {r.target}: {r.shortfall.reason ?? "motivo não informado"}.</span>}
      {r.discard_reasons.length > 0 && <span className="block text-xs text-muted">Descartes: {r.discard_reasons.map((d) => `${d.reason} (${d.count})`).join("; ")}</span>}
    </span>
  );
}
