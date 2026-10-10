import { CONFIDENCE_LABEL, OFFER_LABEL, PRIORITY_LABEL, SITE_LABEL, STAGE_LABEL, type Priority, type SiteStatus, type Stage } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/time";

// Texto com tudo o que importa de um lead, para colar no ChatGPT, num
// documento ou mandar para alguém. Só inclui o que existe.

export type ResumoInput = {
  lead: {
    business_name: string;
    unit_label?: string | null;
    responsible_name?: string | null;
    niche?: string | null;
    services?: string[] | null;
    city: string;
    state: string;
    neighborhood?: string | null;
    phone_e164?: string | null;
    phone_raw?: string | null;
    instagram_handle?: string | null;
    website_url?: string | null;
    site_status: string;
    priority: string;
    stage: string;
    selection_reason?: string | null;
    pending_items?: string | null;
    research_date?: string | null;
    last_contact_at?: string | null;
    next_follow_up_at?: string | null;
  };
  diagnosis?: {
    fit_score: number;
    confidence: string;
    summary: string;
    audience?: string | null;
    digital_presence?: string | null;
    pains?: { pain: string; evidence: string }[] | null;
    opportunities?: string[] | null;
    offer: string;
    offer_reason: string;
    approach?: string | null;
    objections?: string[] | null;
    created_at: string;
  } | null;
  evidences?: { kind: string; summary: string; url?: string | null; limitation?: string | null; observed_at: string }[];
  notes?: { body: string; created_at: string }[];
  outreach?: { status: string; greeting?: string | null; body: string; greeting_sent_at?: string | null; sent_at?: string | null } | null;
  replies?: { body: string; kind: string; received_at: string }[];
};

const line = (label: string, v: string | null | undefined) => (v && v.trim() ? `${label}: ${v.trim()}` : null);

export function leadResumo(i: ResumoInput): string {
  const l = i.lead;
  const d = i.diagnosis;
  const out: (string | null)[] = [];
  out.push(`LEAD: ${l.business_name}${l.unit_label ? ` (${l.unit_label})` : ""}`);
  out.push(line("Responsável", l.responsible_name));
  out.push(line("Cidade", [l.neighborhood, `${l.city}/${l.state}`].filter(Boolean).join(", ")));
  out.push(line("Nicho", l.niche));
  out.push(line("Serviços", l.services?.join(", ")));
  out.push(line("Telefone", l.phone_e164 ?? l.phone_raw));
  out.push(line("Instagram", l.instagram_handle ? `@${l.instagram_handle}` : null));
  out.push(line("Site", l.website_url));
  out.push(line("Situação do site", SITE_LABEL[l.site_status as SiteStatus] ?? l.site_status));
  out.push(line("Etapa", STAGE_LABEL[l.stage as Stage] ?? l.stage));
  out.push(line("Prioridade", PRIORITY_LABEL[l.priority as Priority] ?? l.priority));
  out.push(line("Motivo da seleção", l.selection_reason));
  out.push(line("Pendências", l.pending_items));
  out.push(line("Data da pesquisa", l.research_date ? fmtDate(`${l.research_date}T12:00:00Z`) : null));
  out.push(line("Último contato", l.last_contact_at ? fmtDateTime(l.last_contact_at) : null));
  out.push(line("Próximo retorno", l.next_follow_up_at ? fmtDateTime(l.next_follow_up_at) : null));

  if (d) {
    out.push("", `DIAGNÓSTICO (${fmtDateTime(d.created_at)})`);
    out.push(`Nota: ${d.fit_score}/100 · confiança ${CONFIDENCE_LABEL[d.confidence] ?? d.confidence}`);
    out.push(line("Resumo", d.summary));
    out.push(line("Público", d.audience));
    out.push(line("Presença digital", d.digital_presence));
    if (d.pains?.length) {
      out.push("Dores:");
      for (const p of d.pains) out.push(`- ${p.pain} (evidência: ${p.evidence})`);
    }
    if (d.opportunities?.length) {
      out.push("Oportunidades:");
      for (const o of d.opportunities) out.push(`- ${o}`);
    }
    out.push(line("Oferta recomendada", `${OFFER_LABEL[d.offer] ?? d.offer}: ${d.offer_reason}`));
    out.push(line("Ângulo de abordagem", d.approach));
    out.push(line("Objeções prováveis", d.objections?.join("; ")));
  }

  if (i.evidences?.length) {
    out.push("", "EVIDÊNCIAS");
    for (const e of i.evidences) {
      out.push(`- [${e.kind}] ${e.summary}${e.url ? ` (${e.url})` : ""}${e.limitation ? ` · limitação: ${e.limitation}` : ""}`);
    }
  }
  if (i.notes?.length) {
    out.push("", "OBSERVAÇÕES");
    for (const n of i.notes) out.push(`- ${fmtDate(n.created_at)}: ${n.body}`);
  }
  if (i.outreach) {
    const o = i.outreach;
    out.push("", "ENVIO AUTOMÁTICO");
    out.push(line("Situação", o.status));
    out.push(line("Saudação", o.greeting ? `${o.greeting}${o.greeting_sent_at ? ` (${fmtDateTime(o.greeting_sent_at)})` : ""}` : null));
    out.push(line("Mensagem", `${o.body}${o.sent_at ? ` (enviada ${fmtDateTime(o.sent_at)})` : ""}`));
  }
  if (i.replies?.length) {
    out.push("", "RESPOSTAS DO CLIENTE");
    for (const r of i.replies) out.push(`- ${fmtDateTime(r.received_at)} (${r.kind === "humana" ? "pessoa" : "automática"}): ${r.body}`);
  }
  return out.filter((x) => x !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
