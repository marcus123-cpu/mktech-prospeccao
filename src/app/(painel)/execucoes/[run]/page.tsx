import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { ErrorBox, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { reviewResearchLead } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Qualificação da pesquisa" };

export default async function ResearchReviewPage({ params }: { params: Promise<{ run: string }> }) {
  const { run } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(run)) return <ErrorBox message="Pesquisa inválida." />;
  const { supabase } = await requireAdmin();
  const [request, result] = await Promise.all([
    supabase.from("hermes_requests").select("observations,niche,qualified_target,status").eq("run_id", run).maybeSingle(),
    supabase.from("research_run_leads").select("run_id,lead_id,business_name,phone_e164,site_status,pending_items,verdict,evidence,reviewed_at").eq("run_id", run).order("business_name"),
  ]);
  if (result.error || request.error || !request.data) return <ErrorBox message="Não foi possível carregar os leads desta pesquisa." />;
  const rows = result.data ?? [];
  const confirmed = rows.filter(row => row.verdict === "confirmado").length;
  const pending = rows.filter(row => row.verdict === "pendente").length;
  const rejected = rows.length - confirmed - pending;
  return <>
    <PageHeader title="Qualificação da OBS" subtitle={`${request.data.niche ?? "Pesquisa"} · ${request.data.status}`} />
    <Link href="/execucoes" className="text-sm text-accent">← Pesquisas do Hermes</Link>
    <div className="card my-4 p-4 text-sm"><p className="font-medium">OBS: {request.data.observations}</p><p className="mt-2 text-muted">{rows.length} cadastrados · {confirmed} confirmados · {pending} pendentes · {rejected} rejeitados. Só os confirmados entram automaticamente nos disparos. A classificação automática do Hermes é uma pista; confirme a bio expandida e o destino dos links antes de aprovar.</p></div>
    <ul className="space-y-3">{rows.map(row => <li className="card p-4" key={row.lead_id}>
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.business_name}</strong><span className={row.verdict === "confirmado" ? "text-emerald-300" : row.verdict === "rejeitado" ? "text-rose-300" : "text-amber-300"}>{row.verdict}</span></div>
      <p className="mt-1 text-xs text-muted">{row.phone_e164 ? "Celular cadastrado" : "Sem celular"} · Site: {row.site_status ?? "não verificado"}</p>
      {row.pending_items && <p className="mt-2 whitespace-pre-wrap text-xs text-amber-200">{row.pending_items}</p>}
      {row.evidence && <p className="mt-2 text-xs text-emerald-200">Evidência da revisão: {row.evidence}</p>}
      <ActionForm action={reviewResearchLead} submit="Salvar revisão" className="mt-3 space-y-2">
        <input type="hidden" name="run_id" value={run}/><input type="hidden" name="lead_id" value={row.lead_id}/>
        <div className="flex flex-wrap gap-4 text-sm"><label><input type="radio" name="verdict" value="confirmado" defaultChecked={row.verdict === "confirmado"}/> Confirma OBS</label><label><input type="radio" name="verdict" value="rejeitado" defaultChecked={row.verdict !== "confirmado"}/> Não atende</label></div>
        <textarea name="evidence" className="input w-full" rows={2} minLength={12} maxLength={1000} required defaultValue={row.evidence ?? ""} placeholder="O que aparece na bio expandida? Para onde os links levam?"/>
      </ActionForm>
    </li>)}</ul>
  </>;
}
