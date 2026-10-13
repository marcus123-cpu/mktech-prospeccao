"use client";

import { useActionState } from "react";
import {
  cancelMessage,
  createSenderToken,
  reclassifyReply,
  retryLead,
  returnToSecretary,
  saveOutreachSettings,
  setEnabled,
  setAfterNoon,
  setFollowups,
  setStyles,
  setPaused,
  setSecretary,
  setTodayTarget,
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
  today_new_leads_target?: number | null;
  today_new_leads_date?: string | null;
  window_start: number;
  window_end: number;
  send_days: number[];
  min_fit_score: number;
  followups_enabled?: boolean;
  reply_window_start?: number;
  reply_window_end?: number;
  prospect_after_noon?: boolean;
  secretary_enabled?: boolean;
  message_styles?: "agradecimento" | "alternar";
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

export function TodayTargetForm({ target, sent, enabled, paused }: {
  target: number; sent: number; enabled: boolean; paused: boolean;
}) {
  const [state, action, pending] = useActionState<EnvioState, FormData>(setTodayTarget, {});
  const remaining = Math.max(0, target - sent);
  const stateText = !enabled ? "Envio desligado" : paused ? "Envio pausado" :
    remaining === 0 ? "Meta atingida; novos contatos parados" : `${remaining} novo(s) contato(s) ainda podem sair hoje`;
  return (
    <form action={action} className="card p-4" id="meta-do-dia">
      <h2 className="font-semibold">Controle dos disparos de hoje</h2>
      <p className="mt-1 text-sm text-muted">Você define o total de novos leads que podem receber a primeira saudação hoje. Já foram {sent} de {target}.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="target">Meta de novos contatos hoje</label>
          <input className="input w-32" id="target" name="target" type="number" min="0" max="200" step="1" required defaultValue={target} />
        </div>
        <button className="btn-primary" disabled={pending}>{pending ? "Salvando…" : "Atualizar meta"}</button>
      </div>
      <p className="mt-3 text-sm font-medium">{stateText}</p>
      <p className="mt-1 text-xs text-muted">Aumentar a meta libera o próximo lead da fila, respeitando o horário e o intervalo entre envios. Zero para novos contatos hoje. Mensagens já iniciadas, respostas a clientes e lembretes seguem suas próprias regras.</p>
      <div className="mt-2"><Feedback state={state} /></div>
    </form>
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
      {s.followups_enabled ? (
        <MiniAction action={setFollowups} fields={{ enabled: "false" }} label="Desligar lembretes" variant="btn-ghost" />
      ) : (
        <MiniAction
          action={setFollowups}
          fields={{ enabled: "true" }}
          label="Ligar lembretes"
          variant="btn-ghost"
          confirmText="Ligar os lembretes? Quem conversou com você e parou de responder recebe até 2 lembretes curtos, cada um 2 dias úteis depois da sua última mensagem sem resposta. Eles só saem com o envio automático ligado, dentro do horário e do limite diário."
        />
      )}
      {s.secretary_enabled ? (
        <MiniAction action={setSecretary} fields={{ enabled: "false" }} label="Desligar secretário" variant="btn-ghost" />
      ) : (
        <MiniAction
          action={setSecretary}
          fields={{ enabled: "true" }}
          label="Ligar secretário"
          variant="btn-ghost"
          confirmText={`Ligar o secretário? Depois da mensagem personalizada, o Hermes responde as clientes como você, sem limite de mensagens, das ${s.reply_window_start ?? 8}h às ${s.reply_window_end ?? 18}h. Ele passa a conversa para você em dúvida que não sabe, preço, hora de fechar ou áudio. Só funciona com o envio automático ligado.`}
        />
      )}
      <MiniAction
        action={setAfterNoon}
        fields={{ enabled: s.prospect_after_noon ? "false" : "true" }}
        label={s.prospect_after_noon ? "Prospectar só até o fim do horário" : "Liberar prospecção depois do meio-dia"}
        variant="btn-ghost"
        confirmText={
          s.prospect_after_noon
            ? undefined
            : `Liberar a prospecção (saudação e lembretes) até as ${s.reply_window_end ?? 18}h? Normalmente ela para às ${s.window_end}h; o bot continua respondendo clientes até ${s.reply_window_end ?? 18}h de qualquer forma.`
        }
      />
    </div>
  );
}

export function StylesControl({ s }: { s: OutreachSettings }) {
  const alternating = s.message_styles === "alternar";
  return (
    <div className="space-y-2 text-sm">
      <p>
        Agora: <strong>{alternating ? "alternando (🙏 agradecimento e 👂 lendo a resposta)" : "só 🙏 agradecimento"}</strong>
      </p>
      <p className="text-xs text-muted">
        🙏 Agradecimento: o texto fica pronto antes e sai quando a pessoa responde à saudação. 👂 Lendo a resposta: o Hermes
        espera a pessoa responder, lê o que ela escreveu e só então escreve a mensagem. Vale para os leads que entrarem na
        fila depois da troca.
      </p>
      {alternating ? (
        <MiniAction action={setStyles} fields={{ styles: "agradecimento" }} label="Voltar a usar só o agradecimento" variant="btn-ghost" />
      ) : (
        <MiniAction
          action={setStyles}
          fields={{ styles: "alternar" }}
          label="Alternar os dois estilos"
          variant="btn-ghost"
          confirmText="Alternar os estilos? Cada lead novo na fila pega o estilo contrário ao anterior: um com o agradecimento pronto, o próximo com o texto escrito pelo Hermes depois de ler a resposta da pessoa."
        />
      )}
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
      {num("daily_limit", "Padrão diário de novos contatos", s.daily_limit, 1, 200, "Vale nos próximos dias; a meta de hoje é ajustada no quadro acima. Também limita os lembretes por dia.")}
      {num("min_fit_score", "Nota mínima do diagnóstico", s.min_fit_score, 0, 100)}
      {num("window_start", "Prospecção: começa às (h)", s.window_start, 0, 23)}
      {num("window_end", "Prospecção: para às (h)", s.window_end, 1, 24, "Saudação e lembretes. Horário de São Paulo.")}
      {num("reply_window_start", "Atendimento: começa às (h)", s.reply_window_start ?? 8, 0, 23)}
      {num("reply_window_end", "Atendimento: para às (h)", s.reply_window_end ?? 18, 1, 24, "Resposta aos clientes que já falaram com você.")}
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

export function ReturnToSecretaryButton({ id }: { id: string }) {
  return <MiniAction action={returnToSecretary} fields={{ id }} label="Devolver ao secretário" variant="btn-ghost" />;
}
