import { ESTRATEGIAS } from "@/lib/prospeccao/estrategias";
import { ETAPAS, fmtTaxa, leituraDoTeste, taxa, type LinhaMetricas } from "@/lib/prospeccao/metricas";
import { fmtMoney } from "@/lib/time";

const COLS: LinhaMetricas["estrategia"][] = ["A", "B", "C", "antiga"];
const NOME: Record<LinhaMetricas["estrategia"], string> = {
  A: `A · ${ESTRATEGIAS.A.nome}`,
  B: `B · ${ESTRATEGIAS.B.nome}`,
  C: `C · ${ESTRATEGIAS.C.nome}`,
  antiga: "Antiga (antes do teste)",
};
const BAR: Record<LinhaMetricas["estrategia"], string> = {
  A: "bg-sky-500",
  B: "bg-violet-500",
  C: "bg-amber-500",
  antiga: "bg-zinc-500",
};

const vazio = (estrategia: LinhaMetricas["estrategia"]): LinhaMetricas => ({
  estrategia, contatados: 0, mensagens_entregues: 0, respostas_humanas: 0, respostas_automaticas: 0, respostas_positivas: 0,
  decisores: 0, videos_autorizados: 0, videos_enviados: 0, interesse: 0, propostas_solicitadas: 0, negociacoes: 0,
  oportunidades: 0, vendas: 0, receita: 0,
});

/** Comparação A/B/C: oportunidades qualificadas em destaque, sem declarar vencedora. */
export function TesteABC({ rows }: { rows: LinhaMetricas[] }) {
  const by = Object.fromEntries(COLS.map((c) => [c, rows.find((r) => r.estrategia === c) ?? vazio(c)])) as Record<
    LinhaMetricas["estrategia"],
    LinhaMetricas
  >;
  const leitura = leituraDoTeste(COLS.map((c) => by[c]));
  const max = Math.max(0.0001, ...COLS.map((c) => taxa(by[c].oportunidades, by[c].contatados) ?? 0));
  return (
    <div className="space-y-4 text-sm">
      <p className={leitura.exploratoria ? "rounded-lg bg-amber-500/10 p-3 text-amber-200" : "text-muted"}>{leitura.texto}</p>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted">Oportunidades qualificadas por contato</h3>
        <ul className="space-y-2">
          {COLS.map((c) => {
            const t = taxa(by[c].oportunidades, by[c].contatados);
            return (
              <li key={c} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2">
                <span className="truncate text-xs">{NOME[c]}</span>
                <span className="h-3 rounded bg-panel-2">
                  <span className={`block h-3 rounded ${BAR[c]}`} style={{ width: `${Math.round(((t ?? 0) / max) * 100)}%` }} />
                </span>
                <span className="text-xs tabular-nums">
                  {by[c].oportunidades}/{by[c].contatados} · {fmtTaxa(t)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1 pr-2 font-medium">Etapa</th>
              {COLS.map((c) => <th key={c} className="py-1 pr-2 font-medium">{NOME[c]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ETAPAS.map((e) => (
              <tr key={e.key} className={e.key === "oportunidades" ? "font-semibold" : ""}>
                <td className="py-1 pr-2">{e.label}</td>
                {COLS.map((c) => {
                  const v = by[c][e.key] as number;
                  const t = e.base ? taxa(v, by[c][e.base] as number) : null;
                  return (
                    <td key={c} className="py-1 pr-2 tabular-nums">
                      {v}
                      {e.base && <span className="text-muted"> · {fmtTaxa(t)}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className="py-1 pr-2">Receita confirmada</td>
              {COLS.map((c) => <td key={c} className="py-1 pr-2 tabular-nums">{fmtMoney(by[c].receita)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Contatado = saudação confirmada pelo enviador. A taxa ao lado de cada número usa a etapa de referência (ex.: positivas
        sobre respostas de pessoas). Resposta automática não conta como interesse.
      </p>
    </div>
  );
}
