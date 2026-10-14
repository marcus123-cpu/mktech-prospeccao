import { ActionForm } from "@/components/ActionForm";
import { updateCommercial } from "@/app/(painel)/leads/actions";
import {
  analisarResposta,
  ESTADO_LABEL,
  ESTADOS,
  INTERESSE_LABEL,
  INTERESSES,
  PAPEIS,
  PAPEL_LABEL,
  proximoPasso,
  type Estado,
  type Interesse,
  type Papel,
} from "@/lib/prospeccao/conversa";
import { ESTRATEGIAS, type Estrategia } from "@/lib/prospeccao/estrategias";
import { fmtDateTime } from "@/lib/time";

export type ComercialLead = {
  id: string;
  stage: string;
  do_not_contact: boolean;
  prospect_strategy: Estrategia | null;
  first_contact_at: string | null;
  contact_role: Papel | null;
  conversation_state: Estado | null;
  commercial_interest: Interesse | null;
  video_offered_at: string | null;
  video_authorized_at: string | null;
  video_sent_at: string | null;
  next_follow_up_at: string | null;
  loss_reason: string | null;
};
export type ComercialEvent = { field: string; old_value: string | null; new_value: string | null; source: string; note: string | null; created_at: string };

const FIELD_LABEL: Record<string, string> = {
  estado: "Estado",
  papel_contato: "Quem respondeu",
  interesse: "Interesse",
  video: "Vídeo",
  estrategia: "Estratégia",
  motivo_perda: "Motivo da perda",
  acompanhamento: "Acompanhamento",
};
const SOURCE_LABEL: Record<string, string> = { auto: "automático", hermes: "Hermes", marcos: "você" };

function label(field: string, v: string | null) {
  if (!v) return "—";
  if (field === "estado") return ESTADO_LABEL[v as Estado] ?? v;
  if (field === "papel_contato") return PAPEL_LABEL[v as Papel] ?? v;
  if (field === "interesse") return INTERESSE_LABEL[v as Interesse] ?? v;
  if (field === "acompanhamento") return fmtDateTime(v);
  return v;
}

/** Resultado comercial, derivado da etapa (não duplica o que a ficha já guarda). */
function resultado(l: ComercialLead): string {
  if (l.stage === "fechado") return "Venda fechada";
  if (l.do_not_contact) return "Pediu para não receber mensagens";
  if (l.stage === "sem_interesse" || l.stage === "desqualificado" || l.conversation_state === "encerrado") return "Encerrado sem venda";
  return "Em andamento";
}

export function ComercialCard({ l, events, lastReply }: { l: ComercialLead; events: ComercialEvent[]; lastReply: string | null }) {
  const passo = lastReply
    ? proximoPasso(
        { estado: l.conversation_state, papel: l.contact_role, videoOferecidoEm: l.video_offered_at, videoEnviadoEm: l.video_sent_at },
        analisarResposta({ texto: lastReply, oferecido: !!l.video_offered_at }),
      )
    : null;
  const video = l.video_sent_at
    ? `enviado ${fmtDateTime(l.video_sent_at)}`
    : l.video_authorized_at
      ? `autorizado ${fmtDateTime(l.video_authorized_at)}`
      : l.video_offered_at
        ? `oferecido ${fmtDateTime(l.video_offered_at)}`
        : "não oferecido";
  return (
    <div className="card space-y-4 p-4 text-sm">
      <h2 className="text-sm font-semibold">Comercial</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Item label="Estratégia" value={l.prospect_strategy ? `${l.prospect_strategy} · ${ESTRATEGIAS[l.prospect_strategy].nome}` : "antiga / manual"} />
        <Item label="Primeiro contato" value={l.first_contact_at ? fmtDateTime(l.first_contact_at) : "—"} />
        <Item label="Quem respondeu" value={l.contact_role ? PAPEL_LABEL[l.contact_role] : "—"} />
        <Item label="Estado da conversa" value={l.conversation_state ? ESTADO_LABEL[l.conversation_state] : "—"} />
        <Item label="Interesse comercial" value={l.commercial_interest ? INTERESSE_LABEL[l.commercial_interest] : "—"} />
        <Item label="Vídeo" value={video} />
        <Item label="Acompanhamento" value={l.next_follow_up_at ? fmtDateTime(l.next_follow_up_at) : "—"} />
        <Item label="Resultado comercial" value={resultado(l)} />
        <div className="sm:col-span-2"><Item label="Motivo da perda" value={l.loss_reason ?? "—"} /></div>
      </div>

      {passo && (
        <div className="rounded-lg border border-violet-900 bg-violet-950/30 p-3">
          <div className="label">Próxima ação recomendada</div>
          <p>{passo.acao}</p>
          {passo.passarParaMarcos && <p className="mt-1 text-xs text-amber-300">Com você: {passo.passarParaMarcos}.</p>}
          {passo.referencia && (
            <p className="mt-2 whitespace-pre-wrap text-xs text-muted">
              Referência (adapte antes de usar): {passo.referencia}
            </p>
          )}
        </div>
      )}

      <details>
        <summary className="cursor-pointer text-xs text-muted hover:text-slate-200">Registrar ou corrigir</summary>
        <ActionForm action={updateCommercial} submit="Salvar" className="mt-3 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="lead_id" value={l.id} />
          <select className="input" name="estado" defaultValue="" aria-label="Estado da conversa">
            <option value="">Estado: manter</option>
            {ESTADOS.map((e) => <option key={e} value={e}>{ESTADO_LABEL[e]}</option>)}
          </select>
          <select className="input" name="papel_contato" defaultValue="" aria-label="Quem respondeu">
            <option value="">Quem respondeu: manter</option>
            {PAPEIS.map((p) => <option key={p} value={p}>{PAPEL_LABEL[p]}</option>)}
          </select>
          <select className="input" name="interesse" defaultValue="" aria-label="Interesse">
            <option value="">Interesse: manter</option>
            {INTERESSES.map((i) => <option key={i} value={i}>{INTERESSE_LABEL[i]}</option>)}
          </select>
          <select className="input" name="video" defaultValue="" aria-label="Vídeo">
            <option value="">Vídeo: manter</option>
            <option value="oferecido">Ofereci o vídeo</option>
            <option value="autorizado">Ela autorizou</option>
            <option value="enviado">Enviei o vídeo</option>
          </select>
          <select className="input" name="estrategia" defaultValue="" aria-label="Estratégia">
            <option value="">Estratégia: manter</option>
            {(["A", "B", "C"] as const).map((e) => <option key={e} value={e}>{e} · {ESTRATEGIAS[e].nome}</option>)}
          </select>
          <input className="input" name="motivo_perda" placeholder="Motivo da perda (se houver)" maxLength={500} />
          <input className="input sm:col-span-2" name="nota" placeholder="Nota para o histórico (opcional)" maxLength={500} />
        </ActionForm>
        <p className="mt-2 text-xs text-muted">A data de acompanhamento fica em “Agendar retorno”. Nada aqui envia mensagem.</p>
      </details>

      {events.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted hover:text-slate-200">Histórico comercial ({events.length})</summary>
          <ol className="mt-2 space-y-1 text-xs">
            {events.map((e, i) => (
              <li key={i}>
                <span className="text-muted">{fmtDateTime(e.created_at)} · {SOURCE_LABEL[e.source] ?? e.source}:</span>{" "}
                {FIELD_LABEL[e.field] ?? e.field} {label(e.field, e.old_value)} → {label(e.field, e.new_value)}
                {e.note && <span className="text-muted"> ({e.note})</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="break-words">{value}</div>
    </div>
  );
}
