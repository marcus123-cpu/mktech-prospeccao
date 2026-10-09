"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { markMessageUsed, requestApproach, saveMessageVersion } from "@/app/(painel)/leads/actions";
import {
  MAX_CHARS,
  messageIssues,
  needsCaution,
  STYLE_LABEL,
  STYLES,
  whatsappWithText,
  type ApproachContext,
  type Style,
} from "@/lib/approach";
import { fmtDateTime } from "@/lib/time";

export type LeadMessage = {
  id: string;
  batch_id: string;
  parent_id: string | null;
  style: Style;
  body: string;
  pain_used: string | null;
  evidence_used: string | null;
  risk: string | null;
  alert: string | null;
  source: "hermes" | "edicao";
  created_at: string;
};
export type MessageUse = { id: string; message_id: string; used_at: string };

const RISK_LABEL: Record<string, string> = { baixo: "risco baixo", medio: "risco médio", alto: "risco alto" };

/**
 * Aba Abordagem: mostra as variantes do lote mais recente do Hermes (na
 * versão mais nova de cada uma), permite editar, copiar, abrir no WhatsApp e
 * registrar "Usei esta". Nada aqui envia mensagem ou muda a etapa do lead.
 */
export function ApproachPanel({
  leadId,
  ctx,
  messages,
  uses,
  requestedAt,
}: {
  leadId: string;
  ctx: ApproachContext;
  messages: LeadMessage[];
  uses: MessageUse[];
  requestedAt: string | null;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  // Enquanto há pedido aberto, recarrega os dados a cada 10 s (até 15 min) para
  // as mensagens aparecerem sem precisar apertar F5.
  useEffect(() => {
    if (!requestedAt) return;
    const until = new Date(requestedAt).getTime() + 15 * 60_000;
    const t = setInterval(() => {
      if (Date.now() > until) return clearInterval(t);
      router.refresh();
    }, 10_000);
    return () => clearInterval(t);
  }, [requestedAt, router]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const caution = needsCaution(ctx);

  const { current, alert } = useMemo(() => {
    const hermes = messages.filter((m) => m.source === "hermes").sort((a, b) => b.created_at.localeCompare(a.created_at));
    const batch = hermes[0]?.batch_id;
    if (!batch) return { current: [] as LeadMessage[], alert: null as string | null };
    const inBatch = messages.filter((m) => m.batch_id === batch);
    const latest = STYLES.map((s) =>
      inBatch.filter((m) => m.style === s).sort((a, b) => b.created_at.localeCompare(a.created_at))[0],
    ).filter(Boolean) as LeadMessage[];
    return { current: latest, alert: hermes[0].alert };
  }, [messages]);

  const ask = () =>
    start(async () => {
      setError(null);
      const r = await requestApproach(leadId);
      if (r.error) setError(r.error);
      else
        setNotice(
          r.started
            ? "O Hermes já começou a escrever. As mensagens aparecem aqui sozinhas em 1 a 3 minutos."
            : "Pedido registrado. Com o PC ligado, o Hermes escreve em até 15 minutos.",
        );
    });

  return (
    <div className="card space-y-4 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Abordagem</h2>
          <p className="text-xs text-muted">
            Rascunhos para você revisar e enviar. O sistema não envia nada nem muda a etapa do lead.
          </p>
        </div>
        <button className="btn-ghost" type="button" onClick={ask} disabled={pending || !!requestedAt}>
          {requestedAt ? "Pedido ao Hermes em andamento" : current.length ? "Pedir novas versões ao Hermes" : "Pedir mensagens ao Hermes"}
        </button>
      </div>

      {caution && (
        <div role="alert" className="rounded border border-amber-700/60 bg-amber-500/10 p-3 text-amber-200">
          <strong>Verificação pendente.</strong> Confirme os dados antes de abordar; as mensagens usam forma condicional.
          {ctx.pending_items && <span className="mt-1 block text-xs text-amber-200/80">Pendências: {ctx.pending_items}</span>}
        </div>
      )}
      {alert && <div className="rounded border border-rose-800/60 bg-rose-500/10 p-3 text-rose-200">{alert}</div>}
      {requestedAt && (
        <p className="text-xs text-muted">Pedido de novas versões feito em {fmtDateTime(requestedAt)}.</p>
      )}
      {notice && <p className="text-xs text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}

      {current.length === 0 ? (
        <p className="text-muted">
          Ainda sem mensagens. O Hermes escreve as variantes para leads novos com diagnóstico; você também pode pedir agora.
        </p>
      ) : (
        <div className="space-y-4">
          {current.map((m) => (
            <VariantEditor key={m.id} leadId={leadId} ctx={ctx} message={m} lastUse={uses.find((u) => sameChain(messages, u.message_id, m))} />
          ))}
        </div>
      )}

      <History messages={messages} uses={uses} />
    </div>
  );
}

/** A mensagem usada pertence à mesma variante (mesmo lote e estilo)? */
function sameChain(all: LeadMessage[], usedId: string, m: LeadMessage) {
  const used = all.find((x) => x.id === usedId);
  return !!used && used.batch_id === m.batch_id && used.style === m.style;
}

function VariantEditor({
  leadId,
  ctx,
  message,
  lastUse,
}: {
  leadId: string;
  ctx: ApproachContext;
  message: LeadMessage;
  lastUse?: MessageUse;
}) {
  const [text, setText] = useState(message.body);
  const [baseId, setBaseId] = useState(message.id);
  const [saved, setSaved] = useState(message.body);
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const issues = useMemo(() => messageIssues(ctx, text), [ctx, text]);
  const wa = whatsappWithText(ctx.phone_e164, text);
  const dirty = text.trim() !== saved.trim();

  const save = () =>
    start(async () => {
      const r = await saveMessageVersion(baseId, text);
      if (r.error || !r.id) return setStatus({ error: r.error ?? "Não foi possível salvar." });
      setBaseId(r.id);
      setSaved(text.trim());
      setStatus({ ok: "Versão salva no histórico." });
    });

  const use = () =>
    start(async () => {
      const r = await markMessageUsed(leadId, baseId, text);
      if (r.error || !r.id) return setStatus({ error: r.error ?? "Não foi possível registrar." });
      setBaseId(r.id);
      setSaved(text.trim());
      setStatus({ ok: "Uso registrado. Depois de enviar, use “Marcar como contatado” ao lado." });
      document.getElementById("marcar-contatado")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus({ ok: "Copiado." });
    } catch {
      setStatus({ error: "Não consegui copiar; selecione o texto e copie manualmente." });
    }
  };

  return (
    <div className="space-y-2 rounded border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{STYLE_LABEL[message.style]}</h3>
        <span className="text-xs text-muted">
          {message.risk && RISK_LABEL[message.risk]}
          {message.source === "edicao" && " · editada"} · {fmtDateTime(message.created_at)}
        </span>
      </div>
      <textarea
        className="input min-h-32 w-full"
        value={text}
        maxLength={MAX_CHARS}
        onChange={(e) => {
          setText(e.target.value);
          setStatus({});
        }}
        aria-label={`Mensagem ${STYLE_LABEL[message.style]}`}
      />
      <div className={`text-right text-xs ${text.length > MAX_CHARS - 40 ? "text-amber-300" : "text-muted"}`}>
        {text.length}/{MAX_CHARS}
      </div>
      {issues.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-300">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted">Dor usada</dt>
          <dd>{message.pain_used || "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Evidência usada</dt>
          <dd className="break-words">{message.evidence_used || "—"}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" onClick={copy}>Copiar</button>
        {wa ? (
          <a className="btn-ghost" href={wa} target="_blank" rel="noopener noreferrer">
            Abrir no WhatsApp com esta mensagem
          </a>
        ) : (
          <span className="text-xs text-muted">Sem telefone válido para WhatsApp.</span>
        )}
        <button type="button" className="btn-ghost" onClick={save} disabled={pending || !dirty}>
          Salvar versão
        </button>
        <button type="button" className="btn-primary" onClick={use} disabled={pending}>
          Usei esta
        </button>
        {status.ok && <span className="text-xs text-emerald-300">{status.ok}</span>}
        {status.error && <span role="alert" className="text-xs text-rose-300">{status.error}</span>}
      </div>
      {lastUse && <p className="text-xs text-muted">Você usou esta variante em {fmtDateTime(lastUse.used_at)}.</p>}
    </div>
  );
}

function History({ messages, uses }: { messages: LeadMessage[]; uses: MessageUse[] }) {
  if (messages.length === 0) return null;
  const sorted = [...messages].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <details>
      <summary className="cursor-pointer text-xs text-muted hover:text-slate-200">
        Histórico de versões ({messages.length})
      </summary>
      <ol className="mt-3 space-y-3">
        {sorted.map((m) => {
          const used = uses.filter((u) => u.message_id === m.id);
          return (
            <li key={m.id} className="border-l border-line pl-3">
              <div className="text-xs uppercase tracking-wide text-muted">
                {STYLE_LABEL[m.style]} · {m.source === "hermes" ? "Hermes" : "editada por você"} · {fmtDateTime(m.created_at)}
                {used.length > 0 && ` · usada em ${used.map((u) => fmtDateTime(u.used_at)).join(", ")}`}
              </div>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
