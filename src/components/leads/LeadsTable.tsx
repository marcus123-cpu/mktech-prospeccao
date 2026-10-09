"use client";

import Link from "next/link";
import { useState } from "react";
import { bulkUpdate } from "@/app/(painel)/leads/actions";
import { ActionForm } from "@/components/ActionForm";
import { ContactBadge, PriorityBadge, SiteBadge, StageBadge } from "@/components/ui";
import { OFFER_LABEL } from "@/lib/labels";
import { PRIORITIES, PRIORITY_LABEL, STAGE_LABEL, STAGES, type Priority, type SiteStatus, type Stage } from "@/lib/labels";
import { safeExternal, whatsappLink } from "@/lib/leads-query";
import { fmtDate, fmtDateTime } from "@/lib/time";

export type LeadRow = {
  id: string;
  business_name: string;
  responsible_name: string | null;
  city: string;
  state: string;
  neighborhood: string | null;
  unit_label: string | null;
  phone_raw: string | null;
  phone_e164: string | null;
  instagram_handle: string | null;
  whatsapp_url: string | null;
  website_url: string | null;
  site_status: SiteStatus;
  priority: Priority;
  origin: string;
  stage: Stage;
  contacted: boolean;
  contact_date_unknown: boolean;
  last_contact_at: string | null;
  next_follow_up_at: string | null;
  created_at: string;
  fit_score: number | null;
  recommended_offer: string | null;
};

const BULK_STAGES = STAGES.filter((s) => !["fechado", "sem_interesse", "desqualificado"].includes(s));

export function LeadsTable({ rows }: { rows: LeadRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState("stage");
  const all = rows.length > 0 && selected.size === rows.length;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="card flex flex-wrap items-end gap-3 p-3">
          <span className="text-sm">{selected.size} selecionados</span>
          <ActionForm action={bulkUpdate} submit="Aplicar" className="flex flex-wrap items-end gap-2">
            {[...selected].map((id) => (
              <input key={id} type="hidden" name="ids" value={id} />
            ))}
            <select className="input w-auto" name="action" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="stage">Alterar etapa</option>
              <option value="priority">Alterar prioridade</option>
              <option value="follow_up">Agendar retorno</option>
            </select>
            {action === "stage" && (
              <select className="input w-auto" name="value">
                {BULK_STAGES.map((s) => (
                  <option key={s} value={s}>{STAGE_LABEL[s]}</option>
                ))}
              </select>
            )}
            {action === "priority" && (
              <select className="input w-auto" name="value">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            )}
            {action === "follow_up" && <input className="input w-auto" type="datetime-local" name="value" required />}
          </ActionForm>
          <p className="w-full text-xs text-muted">Ações em lote só alteram dados internos. Nenhuma mensagem é enviada.</p>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[960px]">
          <thead className="border-b border-line">
            <tr>
              <th className="table-head w-8">
                <input
                  type="checkbox"
                  aria-label="Selecionar todos"
                  checked={all}
                  onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
              <th className="table-head">Lead</th>
              <th className="table-head">Cidade</th>
              <th className="table-head">Contato</th>
              <th className="table-head">Etapa</th>
              <th className="table-head">Site</th>
              <th className="table-head">Prioridade</th>
              <th className="table-head">Potencial</th>
              <th className="table-head">Retorno</th>
              <th className="table-head">Cadastro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const wa = whatsappLink(r);
              const site = r.site_status === "site_proprio_encontrado" ? safeExternal(r.website_url) : null;
              return (
                <tr key={r.id} className="hover:bg-panel-2/60">
                  <td className="table-cell">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${r.business_name}`}
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td className="table-cell">
                    <Link href={`/leads/${r.id}`} className="font-medium hover:text-accent">{r.business_name}</Link>
                    {r.unit_label && <span className="ml-1 text-xs text-muted">· {r.unit_label}</span>}
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
                      {r.phone_raw && <span>{r.phone_raw}</span>}
                      {wa && (
                        <a href={wa} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:underline">
                          WhatsApp
                        </a>
                      )}
                      {r.instagram_handle && (
                        <a
                          href={`https://instagram.com/${r.instagram_handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-violet-300 hover:underline"
                        >
                          @{r.instagram_handle}
                        </a>
                      )}
                      {site && (
                        <a href={site} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          Site
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="table-cell text-sm">
                    {r.city}/{r.state}
                    {r.neighborhood && <div className="text-xs text-muted">{r.neighborhood}</div>}
                  </td>
                  <td className="table-cell">
                    <ContactBadge contacted={r.contacted} unknownDate={r.contact_date_unknown} />
                    {r.last_contact_at && <div className="mt-1 text-xs text-muted">{fmtDateTime(r.last_contact_at)}</div>}
                  </td>
                  <td className="table-cell"><StageBadge stage={r.stage} /></td>
                  <td className="table-cell"><SiteBadge status={r.site_status} /></td>
                  <td className="table-cell"><PriorityBadge priority={r.priority} /></td>
                  <td className="table-cell text-xs">
                    {r.fit_score === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <>
                        <div className="font-semibold">{r.fit_score}/100</div>
                        {r.recommended_offer && <div className="text-muted">{OFFER_LABEL[r.recommended_offer] ?? r.recommended_offer}</div>}
                      </>
                    )}
                  </td>
                  <td className="table-cell text-xs">
                    {r.next_follow_up_at ? (
                      <span className={new Date(r.next_follow_up_at) < new Date() ? "text-rose-300" : ""}>
                        {fmtDateTime(r.next_follow_up_at)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="table-cell text-xs text-muted">{fmtDate(r.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
