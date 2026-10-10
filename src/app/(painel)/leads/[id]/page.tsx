import Link from "next/link";
import { DiagnosisCard, type Diagnosis } from "@/components/leads/DiagnosisCard";
import { NextStep } from "@/components/leads/NextStep";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { LeadFields } from "@/components/leads/LeadForm";
import { ContactBadge, PriorityBadge, SiteBadge, StageBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { CHANNEL_LABEL, CHANNELS, EVIDENCE_LABEL, ORIGIN_LABEL, STAGE_LABEL, STAGES, type Origin, type Stage } from "@/lib/labels";
import { safeExternal, whatsappLink } from "@/lib/leads-query";
import { fmtDate, fmtDateTime, fmtMoney, isoToSpLocal } from "@/lib/time";
import {
  addNote,
  changeStage,
  correctContact,
  deleteLead,
  markContacted,
  registerClosing,
  registerProposal,
  scheduleFollowUp,
  updateLead,
} from "../actions";

export const metadata = { title: "Lead" };

type TimelineItem = { at: string | null; sort: number; kind: string; node: React.ReactNode };

export default async function LeadDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ja_existia?: string }>;
}) {
  const { id } = await params;
  const { ja_existia } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireAdmin();

  const [lead, contacts, stages, notes, proposals, evidences, diagnoses] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).maybeSingle(),
    supabase.from("contact_events").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("stage_events").select("*").eq("lead_id", id).order("changed_at", { ascending: false }),
    supabase.from("lead_notes").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
    supabase.from("proposals").select("*").eq("lead_id", id).order("sent_at", { ascending: false }),
    supabase.from("lead_evidences").select("*").eq("lead_id", id).order("observed_at", { ascending: false }),
    supabase.from("lead_diagnoses").select("*").eq("lead_id", id).order("created_at", { ascending: false }).limit(20),
  ]);
  if (!lead.data) notFound();
  const l = lead.data;
  const wa = whatsappLink(l);
  const site = safeExternal(l.website_url);
  const nowLocal = isoToSpLocal(new Date());

  const timeline: TimelineItem[] = [
    ...(contacts.data ?? []).map((c) => ({
      at: c.occurred_at ?? c.created_at,
      sort: new Date(c.occurred_at ?? c.created_at).getTime(),
      kind: "contato",
      node: (
        <div className={c.voided_at ? "opacity-60" : ""}>
          <div className="font-medium">
            {c.voided_at ? <s>Contato ({CHANNEL_LABEL[c.channel as keyof typeof CHANNEL_LABEL] ?? c.channel})</s> : <>Contato ({CHANNEL_LABEL[c.channel as keyof typeof CHANNEL_LABEL] ?? c.channel})</>}
            {!c.occurred_at && <span className="ml-2 text-xs text-amber-300">data não informada (importado)</span>}
            {c.corrects_event_id && <span className="ml-2 text-xs text-muted">correção de registro anterior</span>}
          </div>
          {c.note && <p className="text-sm text-muted">{c.note}</p>}
          {c.voided_at ? (
            <p className="text-xs text-rose-300">Anulado em {fmtDateTime(c.voided_at)}: {c.void_reason}</p>
          ) : (
            <details className="mt-1 text-sm">
              <summary className="cursor-pointer text-xs text-muted hover:text-slate-200">Corrigir este contato</summary>
              <ActionForm action={correctContact} submit="Salvar correção" variant="btn-ghost" className="mt-2 grid gap-2 sm:grid-cols-3">
                <input type="hidden" name="event_id" value={c.id} />
                <input type="hidden" name="lead_id" value={id} />
                <input className="input sm:col-span-2" name="reason" placeholder="Motivo (obrigatório)" required maxLength={500} />
                <input className="input" type="datetime-local" name="new_occurred_at" title="Data correta (deixe vazio se o contato não aconteceu)" />
              </ActionForm>
            </details>
          )}
        </div>
      ),
    })),
    ...(stages.data ?? []).map((s) => ({
      at: s.changed_at,
      sort: new Date(s.changed_at).getTime(),
      kind: "etapa",
      node: (
        <div>
          <span className="font-medium">
            {s.from_stage ? `${STAGE_LABEL[s.from_stage as Stage]} → ` : "Cadastrado como "}
            {STAGE_LABEL[s.to_stage as Stage]}
          </span>
          {s.note && <p className="text-sm text-muted">{s.note}</p>}
        </div>
      ),
    })),
    ...(notes.data ?? []).map((n) => ({
      at: n.created_at,
      sort: new Date(n.created_at).getTime(),
      kind: n.source === "importacao" ? "observação importada" : "observação",
      node: <p className="whitespace-pre-wrap text-sm">{n.body}</p>,
    })),
    ...(proposals.data ?? []).map((p) => ({
      at: p.sent_at,
      sort: new Date(p.sent_at).getTime(),
      kind: "proposta",
      node: (
        <div>
          <span className="font-medium">Proposta de {fmtMoney(p.value)}</span>
          {p.note && <p className="text-sm text-muted">{p.note}</p>}
        </div>
      ),
    })),
    ...(evidences.data ?? []).map((e) => {
      const url = safeExternal(e.url);
      return {
        at: e.observed_at,
        sort: new Date(e.observed_at).getTime(),
        kind: `evidência · ${EVIDENCE_LABEL[e.kind] ?? e.kind}`,
        node: (
          <div className="text-sm">
            <p>{e.summary}</p>
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-xs text-accent hover:underline">
                {e.url}
              </a>
            )}
            {e.limitation && <p className="text-xs text-amber-300">Limitação: {e.limitation}</p>}
          </div>
        ),
      };
    }),
  ].sort((a, b) => b.sort - a.sort);

  return (
    <div className="space-y-6">
      {ja_existia && (
        <p className="rounded-lg bg-amber-950/50 p-3 text-sm text-amber-200">
          Este negócio já estava cadastrado. Nenhuma ficha nova foi criada.
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/leads" className="text-xs text-muted hover:text-slate-200">← Leads</Link>
          <h1 className="mt-1 text-2xl font-semibold">
            {l.business_name}
            {l.unit_label && <span className="ml-2 text-base font-normal text-muted">· {l.unit_label}</span>}
          </h1>
          <p className="text-sm text-muted">
            {[l.responsible_name, [l.neighborhood, `${l.city}/${l.state}`].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StageBadge stage={l.stage} />
            <ContactBadge contacted={l.contacted} unknownDate={l.contact_date_unknown} />
            <SiteBadge status={l.site_status} />
            <PriorityBadge priority={l.priority} />
            <span className="text-xs text-muted">Origem: {ORIGIN_LABEL[l.origin as Origin]}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {wa && <a className="btn-ghost" href={wa} target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>}
          {l.instagram_handle && (
            <a className="btn-ghost" href={`https://instagram.com/${l.instagram_handle}`} target="_blank" rel="noopener noreferrer">
              Abrir Instagram
            </a>
          )}
          {site && <a className="btn-ghost" href={site} target="_blank" rel="noopener noreferrer">Abrir site</a>}
        </div>
      </div>
      <p className="text-xs text-muted">Abrir o WhatsApp não registra contato. Use “Marcar como contatado” depois de falar com o lead.</p>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="space-y-6">
          <NextStep stage={l.stage as Stage} />
          <DiagnosisCard d={(diagnoses.data?.[0] as Diagnosis | undefined) ?? null} olderCount={Math.max((diagnoses.data?.length ?? 0) - 1, 0)} />
          <div className="card grid gap-4 p-4 text-sm sm:grid-cols-2">
            <Info label="Telefone original" value={l.phone_raw} />
            <Info label="Telefone normalizado" value={l.phone_e164 ?? (l.phone_raw ? "não reconhecido" : null)} />
            <Info label="Instagram" value={l.instagram_raw} />
            <Info label="Site" value={l.website_url} />
            <Info label="Nicho" value={l.niche} />
            <Info label="Serviços" value={l.services?.join(", ")} />
            <Info label="Data da pesquisa" value={l.research_date ? fmtDate(`${l.research_date}T12:00:00Z`) : null} />
            <Info label="Fonte" value={l.source_place_id ? `${l.source_name ?? "fonte"}: ${l.source_place_id}` : null} />
            <Info label="Primeiro contato" value={l.first_contact_at ? fmtDateTime(l.first_contact_at) : l.contacted ? "sem data" : null} />
            <Info label="Último contato" value={l.last_contact_at ? fmtDateTime(l.last_contact_at) : null} />
            <Info label="Próximo retorno" value={l.next_follow_up_at ? fmtDateTime(l.next_follow_up_at) : null} />
            <Info label="Proposta" value={l.proposal_value !== null ? `${fmtMoney(l.proposal_value)} em ${fmtDate(l.proposal_sent_at)}` : null} />
            <Info label="Fechamento" value={l.closed_value !== null ? `${fmtMoney(l.closed_value)} em ${fmtDate(l.closed_at)}` : null} />
            <Info label="Motivo de descarte/perda" value={l.loss_reason} />
            <div className="sm:col-span-2"><Info label="Motivo da seleção" value={l.selection_reason} /></div>
            <div className="sm:col-span-2"><Info label="Pendências" value={l.pending_items} /></div>
            <div className="text-xs text-muted sm:col-span-2">
              Criado em {fmtDateTime(l.created_at)} · atualizado em {fmtDateTime(l.updated_at)}
            </div>
          </div>

          <div className="card p-4">
            <h2 className="mb-4 text-sm font-semibold">Histórico</h2>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted">Sem registros ainda.</p>
            ) : (
              <ol className="space-y-4 border-l border-line pl-4">
                {timeline.map((t, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" />
                    <div className="text-xs uppercase tracking-wide text-muted">
                      {t.kind} · {fmtDateTime(t.at)}
                    </div>
                    {t.node}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <Panel title="Marcar como contatado">
            <ActionForm action={markContacted} submit="Marcar como contatado">
              <input type="hidden" name="lead_id" value={id} />
              <div className="grid grid-cols-2 gap-2">
                <select className="input" name="channel" defaultValue="whatsapp" aria-label="Canal">
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
                  ))}
                </select>
                <input className="input" type="datetime-local" name="occurred_at" defaultValue={nowLocal} max={nowLocal} aria-label="Data do contato" />
              </div>
              <input className="input" name="note" placeholder="Observação do contato (opcional)" maxLength={2000} />
            </ActionForm>
          </Panel>

          <Panel title="Alterar etapa">
            <ActionForm action={changeStage} submit="Alterar etapa">
              <input type="hidden" name="lead_id" value={id} />
              <select className="input" name="stage" defaultValue={l.stage}>
                {STAGES.filter((s) => s !== "fechado").map((s) => (
                  <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                ))}
              </select>
              <input className="input" name="reason" placeholder="Motivo (obrigatório para Sem interesse/Desqualificado)" maxLength={500} />
              <input className="input" name="note" placeholder="Nota (opcional)" maxLength={2000} />
            </ActionForm>
          </Panel>

          <Panel title="Agendar retorno">
            <ActionForm action={scheduleFollowUp} submit="Salvar retorno">
              <input type="hidden" name="lead_id" value={id} />
              <input
                className="input"
                type="datetime-local"
                name="at"
                defaultValue={l.next_follow_up_at ? isoToSpLocal(l.next_follow_up_at) : ""}
                aria-label="Data do retorno"
              />
              <p className="text-xs text-muted">Deixe vazio para remover o retorno.</p>
            </ActionForm>
          </Panel>

          <Panel title="Adicionar observação">
            <ActionForm action={addNote} submit="Salvar observação">
              <input type="hidden" name="lead_id" value={id} />
              <textarea className="input" name="body" rows={3} required maxLength={5000} />
            </ActionForm>
          </Panel>

          <Panel title="Registrar proposta">
            <ActionForm action={registerProposal} submit="Registrar proposta">
              <input type="hidden" name="lead_id" value={id} />
              <div className="grid grid-cols-2 gap-2">
                <input className="input" name="value" inputMode="decimal" placeholder="Valor (R$)" required />
                <input className="input" type="datetime-local" name="sent_at" defaultValue={nowLocal} required />
              </div>
              <input className="input" name="note" placeholder="Descrição (opcional)" maxLength={2000} />
            </ActionForm>
          </Panel>

          <Panel title="Registrar fechamento">
            <ActionForm action={registerClosing} submit="Registrar fechamento" confirmText="Confirmar o fechamento desta venda?">
              <input type="hidden" name="lead_id" value={id} />
              <div className="grid grid-cols-2 gap-2">
                <input className="input" name="value" inputMode="decimal" placeholder="Valor fechado (R$)" required />
                <input className="input" type="datetime-local" name="closed_at" defaultValue={nowLocal} required />
              </div>
              <input className="input" name="note" placeholder="Nota (opcional)" maxLength={2000} />
            </ActionForm>
          </Panel>

          <details className="card p-4">
            <summary className="cursor-pointer text-sm font-semibold">Editar dados cadastrais</summary>
            <div className="mt-4">
              <ActionForm action={updateLead} submit="Salvar dados">
                <input type="hidden" name="lead_id" value={id} />
                <LeadFields v={l} />
              </ActionForm>
            </div>
          </details>

          <details className="card border-rose-900/60 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-rose-300">Excluir lead (pedido do titular)</summary>
            <div className="mt-4">
              <ActionForm action={deleteLead} submit="Excluir definitivamente" variant="btn-danger">
                <input type="hidden" name="lead_id" value={id} />
                <input className="input" name="reason" placeholder="Motivo da exclusão" required maxLength={500} />
                <input className="input" name="confirm" placeholder="Digite EXCLUIR" required />
                <p className="text-xs text-muted">Apaga a ficha e todo o histórico. Use apenas quando o titular pedir.</p>
              </ActionForm>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="break-words">{value || <span className="text-muted">—</span>}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}
