"use client";

import { useActionState } from "react";
import { createToken, revokeToken, saveSettings, type TokenState } from "./actions";

type Settings = {
  daily_target: number;
  cities: string[];
  niches: string[];
  max_run_minutes: number;
  max_searches: number;
  max_cost_usd: number;
  routine_enabled: boolean;
};

function Feedback({ state }: { state: TokenState }) {
  return (
    <>
      {state.error && <span role="alert" className="text-sm text-rose-300">{state.error}</span>}
      {state.ok && <span className="text-sm text-emerald-300">{state.ok}</span>}
    </>
  );
}

export function SettingsForm({ s }: { s: Settings }) {
  const [state, action, pending] = useActionState<TokenState, FormData>(saveSettings, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="daily_target">Meta diária (até)</label>
        <input className="input" id="daily_target" name="daily_target" type="number" min={1} max={100} defaultValue={s.daily_target} />
      </div>
      <div>
        <label className="label" htmlFor="max_run_minutes">Tempo máximo por execução (min)</label>
        <input className="input" id="max_run_minutes" name="max_run_minutes" type="number" min={5} max={240} defaultValue={s.max_run_minutes} />
      </div>
      <div>
        <label className="label" htmlFor="max_searches">Máximo de pesquisas por execução</label>
        <input className="input" id="max_searches" name="max_searches" type="number" min={1} max={500} defaultValue={s.max_searches} />
      </div>
      <div>
        <label className="label" htmlFor="max_cost_usd">Custo máximo por execução (US$)</label>
        <input className="input" id="max_cost_usd" name="max_cost_usd" type="number" step="0.01" min={0} defaultValue={s.max_cost_usd} />
        <p className="mt-1 text-xs text-muted">0 = usar só serviços gratuitos.</p>
      </div>
      <div>
        <label className="label" htmlFor="cities">Cidades (uma por linha)</label>
        <textarea className="input" id="cities" name="cities" rows={5} defaultValue={s.cities.join("\n")} />
      </div>
      <div>
        <label className="label" htmlFor="niches">Nichos (um por linha)</label>
        <textarea className="input" id="niches" name="niches" rows={5} defaultValue={s.niches.join("\n")} />
      </div>
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="routine_enabled" defaultChecked={s.routine_enabled} className="mt-1" />
        <span>
          Rotina diária liberada
          <span className="block text-xs text-muted">
            Desmarcado, o script recusa execuções agendadas (a pesquisa manual continua funcionando). Isso não liga nem
            desliga o Hermes; o agendamento fica no Hermes.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Salvando…" : "Salvar configurações"}</button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function NewTokenForm() {
  const [state, action, pending] = useActionState<TokenState, FormData>(createToken, {});
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" name="name" placeholder="Ex.: Hermes no PC" required maxLength={80} />
        <button className="btn-primary" disabled={pending}>{pending ? "Criando…" : "Criar token"}</button>
      </div>
      <Feedback state={state} />
      {state.token && (
        <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-3">
          <code className="block break-all text-sm text-amber-100">{state.token}</code>
          <p className="mt-2 text-xs text-amber-200">
            Cole em MKTECH_CRM_TOKEN no arquivo hermes/.env do seu PC. Não envie por chat nem salve no Git.
          </p>
        </div>
      )}
    </form>
  );
}

export function RevokeButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<TokenState, FormData>(revokeToken, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Revogar este token? O Hermes que usa ele vai parar de acessar o CRM.")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="btn-danger" disabled={pending}>Revogar</button>
      <Feedback state={state} />
    </form>
  );
}
