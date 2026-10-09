"use client";

import Link from "next/link";
import { useActionState, useMemo, useState, useTransition } from "react";
import { TARGET_FIELDS, buildRows, guessMapping, type Mapping, type TargetKey } from "@/lib/import";
import { SITE_LABEL, type SiteStatus } from "@/lib/labels";
import { parseSpreadsheet, runImport, type ImportResult, type ParseResult } from "./actions";

const STATUS_LABEL: Record<string, string> = {
  criado: "Novo",
  existente: "Já existe",
  possivel_duplicado: "Possível duplicado",
  invalido: "Inválido",
};

export function Importer() {
  const [parsed, parseAction, parsing] = useActionState<ParseResult, FormData>(parseSpreadsheet, {});
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [defaultCity, setDefaultCity] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const effectiveMapping = mapping ?? (parsed.headers ? guessMapping(parsed.headers) : {});
  const built = useMemo(
    () => (parsed.rows ? buildRows(parsed.rows, effectiveMapping, defaultCity) : []),
    [parsed.rows, effectiveMapping, defaultCity],
  );
  const missingRequired = TARGET_FIELDS.filter(
    (f) => f.required && effectiveMapping[f.key] === undefined && !(f.key === "city" && defaultCity),
  );

  const setField = (key: TargetKey, value: string) => {
    const next = { ...effectiveMapping };
    if (value === "") delete next[key];
    else next[key] = Number(value);
    setMapping(next);
    setResult(null);
  };

  const go = (dryRun: boolean) =>
    start(async () => {
      setResult(await runImport(JSON.stringify(built), dryRun));
    });

  return (
    <div className="space-y-6">
      <form action={parseAction} className="card flex flex-wrap items-end gap-3 p-4" onSubmit={() => { setMapping(null); setResult(null); }}>
        <div>
          <label className="label" htmlFor="file">Arquivo (.xlsx ou .csv)</label>
          <input className="input" type="file" id="file" name="file" accept=".xlsx,.csv,.txt" required />
        </div>
        <button className="btn-primary" disabled={parsing}>{parsing ? "Lendo…" : "Ler arquivo"}</button>
        {parsed.error && <span role="alert" className="text-sm text-rose-300">{parsed.error}</span>}
      </form>

      {parsed.headers && (
        <section className="card p-4">
          <h2 className="mb-1 text-sm font-semibold">1. Mapeamento de colunas · {parsed.fileName}</h2>
          <p className="mb-4 text-xs text-muted">{parsed.rows?.length} linhas encontradas. Confira de qual coluna vem cada campo.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TARGET_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="label" htmlFor={`map-${f.key}`}>{f.label}{f.required ? " *" : ""}</label>
                <select
                  id={`map-${f.key}`}
                  className="input"
                  value={effectiveMapping[f.key] ?? ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                >
                  <option value="">— não importar —</option>
                  {parsed.headers!.map((h, i) => (
                    <option key={i} value={i}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
            <div>
              <label className="label" htmlFor="defaultCity">Cidade padrão (se a coluna estiver vazia)</label>
              <input id="defaultCity" className="input" value={defaultCity} onChange={(e) => { setDefaultCity(e.target.value); setResult(null); }} />
            </div>
          </div>

          <h3 className="mb-2 mt-6 text-sm font-semibold">Como as primeiras linhas serão lidas</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="border-b border-line">
                <tr>
                  {["Nome", "Cidade", "Telefone (texto)", "Instagram", "Contatado", "Site", "Desqualificação"].map((h) => (
                    <th key={h} className="table-head">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {built.slice(0, 8).map((r, i) => (
                  <tr key={i}>
                    <td className="table-cell">{r.business_name}</td>
                    <td className="table-cell">{r.city}</td>
                    <td className="table-cell font-mono text-xs">{r.phone}</td>
                    <td className="table-cell">{r.instagram}</td>
                    <td className="table-cell">{r.contacted === "sim" ? "Sim (sem data)" : r.contacted === "nao" ? "Não" : "—"}</td>
                    <td className="table-cell text-xs">{SITE_LABEL[r.site_status as SiteStatus]}</td>
                    <td className="table-cell text-xs text-rose-300">{r.disqualify_reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn-ghost" disabled={pending || missingRequired.length > 0} onClick={() => go(true)}>
              {pending ? "Verificando…" : "2. Validar e verificar duplicados"}
            </button>
            {missingRequired.length > 0 && (
              <span className="text-sm text-amber-300">Mapeie: {missingRequired.map((f) => f.label).join(", ")}</span>
            )}
          </div>
        </section>
      )}

      {result?.error && <p role="alert" className="text-sm text-rose-300">{result.error}</p>}

      {result?.counts && (
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">
            {result.dryRun ? "Prévia (nada foi salvo ainda)" : "Importação concluída"}
          </h2>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(STATUS_LABEL).map(([k, label]) => (
              <div key={k} className="rounded-lg bg-panel-2 p-3">
                <div className="text-xs text-muted">{result.dryRun ? `${label} (previsto)` : label === "Novo" ? "Importados" : label}</div>
                <div className="text-xl font-semibold">{result.counts?.[k] ?? 0}</div>
              </div>
            ))}
          </div>
          {(result.rows ?? []).some((r) => r.status !== "criado") && (
            <details className="mb-4 text-sm">
              <summary className="cursor-pointer text-muted">Ver linhas que não serão importadas como novas</summary>
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                {(result.rows ?? [])
                  .filter((r) => r.status !== "criado")
                  .map((r) => (
                    <li key={r.row}>
                      Linha {r.row + 1}: {STATUS_LABEL[r.status]}
                      {r.errors && ` — ${r.errors.join("; ")}`}
                      {r.lead_id && (
                        <> — <Link className="text-accent" href={`/leads/${r.lead_id}`}>ver ficha</Link></>
                      )}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          {result.dryRun ? (
            <button className="btn-primary" disabled={pending} onClick={() => go(false)}>
              {pending ? "Importando…" : "3. Confirmar importação"}
            </button>
          ) : (
            <div className="flex gap-2">
              <Link href="/leads" className="btn-primary">Ver leads</Link>
              {(result.counts.possivel_duplicado ?? 0) > 0 && <Link href="/leads/duplicados" className="btn-ghost">Revisar duplicados</Link>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
