import { CONFIDENCE_LABEL, OFFER_LABEL } from "@/lib/labels";
import { fmtDateTime } from "@/lib/time";

export type Diagnosis = {
  id: string;
  fit_score: number;
  confidence: string;
  summary: string;
  audience: string | null;
  digital_presence: string | null;
  pains: { pain: string; evidence: string }[];
  opportunities: string[];
  offer: string;
  offer_reason: string;
  approach: string | null;
  objections: string[];
  created_at: string;
};

/** Diagnóstico comercial da pesquisa mais recente do Hermes. Só leitura. */
export function DiagnosisCard({ d, olderCount }: { d: Diagnosis | null; olderCount: number }) {
  if (!d) {
    return (
      <div className="card p-4 text-sm">
        <h2 className="mb-1 text-sm font-semibold">Diagnóstico</h2>
        <p className="text-muted">Ainda sem diagnóstico. Leads pesquisados pelo Hermes a partir de agora trazem a análise aqui.</p>
      </div>
    );
  }
  const scoreColor = d.fit_score >= 70 ? "text-emerald-300" : d.fit_score >= 40 ? "text-amber-300" : "text-rose-300";
  return (
    <div className="card space-y-4 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Diagnóstico</h2>
          <p className="text-xs text-muted">
            Pesquisa de {fmtDateTime(d.created_at)} · {CONFIDENCE_LABEL[d.confidence] ?? d.confidence}
            {olderCount > 0 && ` · ${olderCount} versão(ões) anterior(es)`}
          </p>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-semibold ${scoreColor}`}>{d.fit_score}<span className="text-sm text-muted">/100</span></div>
          <div className="text-xs text-muted">potencial</div>
        </div>
      </div>

      <p>{d.summary}</p>

      <div className="rounded-lg border border-line bg-panel-2 p-3">
        <div className="label">Oferta sugerida</div>
        <div className="font-semibold">{OFFER_LABEL[d.offer] ?? d.offer}</div>
        <p className="mt-1">{d.offer_reason}</p>
      </div>

      {d.pains.length > 0 && (
        <div>
          <div className="label">Dores percebidas</div>
          <ul className="mt-1 space-y-2">
            {d.pains.map((p, i) => (
              <li key={i}>
                <div className="font-medium">{p.pain}</div>
                <div className="text-xs text-muted">Evidência: {p.evidence}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <List title="Como a MKTech ajuda" items={d.opportunities} />

      {d.approach && (
        <div>
          <div className="label">Ângulo de abordagem</div>
          <p className="mt-1 whitespace-pre-line">{d.approach}</p>
        </div>
      )}

      <List title="Objeções prováveis" items={d.objections} />

      <div className="grid gap-3 sm:grid-cols-2">
        {d.audience && (
          <div>
            <div className="label">Público</div>
            <p className="mt-1">{d.audience}</p>
          </div>
        )}
        {d.digital_presence && (
          <div>
            <div className="label">Presença digital</div>
            <p className="mt-1">{d.digital_presence}</p>
          </div>
        )}
      </div>
      <p className="text-xs text-muted">Gerado pelo Hermes a partir de páginas públicas. Confira as evidências antes de abordar.</p>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="label">{title}</div>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
