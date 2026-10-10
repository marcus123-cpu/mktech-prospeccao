"use client";

import { useActionState } from "react";
import {
  cancelMessage,
  createSenderToken,
  reclassifyReply,
  retryLead,
  saveOutreachSettings,
  setEnabled,
  setPaused,
  type EnvioState,
} from "./actions";

type Action = (s: EnvioState, f: FormData) => Promise<EnvioState>;

export type OutreachSettings = {
  enabled: boolean;
  paused: boolean;
  min_delay_seconds: number;
  max_delay_seconds: number;
  greeting_gap_min_seconds: number;
  greeting_gap_max_seconds: number;
  daily_limit: number;
  window_start: number;
  window_end: number;
  send_days: number[];
  min_fit_score: number;
};

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function Feedback({ state }: { state: EnvioState }) {
  return (
    <>
      {state.error && <span role="alert" className="text-sm text-rose-300">{state.error}</span>}
      {state.ok && <span className="text-sm text-emerald-300">{state.ok}</span>}
    </>
  );
}

/** Botão único com campos escondidos e confirmação opcional. */
function MiniAction({
  action,
  fields,
  label,
  variant = "btn-ghost",
  confirmText,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  variant?: string;
  confirmText?: string;
}) {
  const [state, formAction, pending] = useActionState<EnvioState, FormData>(action, {});
  return (
    <form
      action={formAction}
      className="inline-flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button className={variant} disabled={pending}>{pending ? "…" : label}</button>
      <Feedback state={state} />
    </form>
  );
}

export function SwitchControls({ s }: { s: OutreachSettings }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {s.enabled ? (
        <MiniAction action={setEnabled} fields={{ enabled: "false" }} label="Desligar envio" variant="btn-danger" />
      ) : (
        <MiniAction
          action={setEnabled}
          fields={{ enabled: "true" }}
          label="Ligar envio automático"
          variant="btn-primary"
          confirmText="Ligar o envio automático? O enviador do PC vai mandar mensagens de WhatsApp para os leads da fila, respeitando o horário, o limite diário e o tempo de espera."
        />
      )}
      {s.enabled &&
        (s.paused ? (
          <MiniAction action={setPaused} fields={{ paused: "false" }} label="Retomar" variant="btn-primary" />
        ) : (
          <MiniAction action={setPaused} fields={{ paused: "true" }} label="Pausar agora" variant="btn-ghost" />
        ))}
    </div>
  );
}

export function OutreachSettingsForm({ s }: { s: OutreachSettings }) {
  const [state, action, pending] = useActionState<EnvioState, FormData>(saveOutreachSettings, {});
  const num = (name: string, label: string, value: number, min: number, max: number, hint?: string, step?: number) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input className="input" id={name} name={name} type="number" min={min} max={max} step={step ?? 1} defaultValue={value} />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {num("min_delay_minutes", "Espera mínima entre um lead e outro (min)", s.min_delay_seconds / 60, 1, 1440, undefined, 0.5)}
      {num("max_delay_minutes", "Espera máxima entre um lead e outro (min)", s.max_delay_seconds / 60, 1, 1440, "O tempo é sorteado entre o mínimo e o máximo.", 0.5)}
      {num("greeting_gap_min_seconds", "Depois da saudação, esperar no mínimo (s)", s.greeting_gap_min_seconds, 10, 1800)}
      {num("greeting_gap_max_seconds", "Depois da saudação, esperar no máximo (s)", s.greeting_gap_max_seconds, 10, 1800)}
      {num("daily_limit", "Leads abordados por dia (até)", s.daily_limit, 1, 200, "Começar baixo reduz o risco de bloqueio do WhatsApp.")}
      {num("min_fit_score", "Nota mínima do diagnóstico", s.min_fit_score, 0, 100)}
      {num("window_start", "Horário: começa às (h)", s.window_start, 0, 23)}
      {num("window_end", "Horário: para às (h)", s.window_end, 1, 24, "Horário de São Paulo.")}
      <fieldset className="sm:col-span-2">
        <legend className="label">Dias da semana</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1">
              <input type="checkbox" name="send_days" value={i + 1} defaultChecked={s.send_days.includes(i + 1)} />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function CancelButton({ id }: { id: string }) {
  return <MiniAction action={cancelMessage} fields={{ id }} label="Cancelar" variant="btn-danger" confirmText="Cancelar esta mensagem? Ela não será enviada." />;
}

export function ReclassifyButton({ id, to }: { id: string; to: "automatica" | "humana" }) {
  return (
    <MiniAction
      action={reclassifyReply}
      fields={{ id, kind: to }}
      label={to === "humana" ? "É uma pessoa" : "É automática"}
      variant="btn-ghost"
    />
  );
}

export function RetryButton({ id }: { id: string }) {
  return <MiniAction action={retryLead} fields={{ id }} label="Tentar de novo" variant="btn-ghost" />;
}

export function SenderTokenForm() {
  const [state, action, pending] = useActionState<EnvioState, FormData>(createSenderToken, {});
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" name="name" placeholder="Enviador no PC" maxLength={80} />
        <button className="btn-ghost" disabled={pending}>{pending ? "Criando…" : "Criar token do enviador"}</button>
      </div>
      <Feedback state={state} />
      {state.token && (
        <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-3">
          <code className="block break-all text-sm text-amber-100">{state.token}</code>
          <p className="mt-2 text-xs text-amber-200">
            Cole em MKTECH_ENVIO_TOKEN no arquivo envio/.env do seu PC. Este token só opera a fila de envio.
          </p>
        </div>
      )}
    </form>
  );
}
