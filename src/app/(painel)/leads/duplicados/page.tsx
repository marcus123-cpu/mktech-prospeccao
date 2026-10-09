import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Empty, ErrorBox, PageHeader } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { ORIGIN_LABEL, REVIEW_REASON_LABEL, type Origin } from "@/lib/labels";
import { fmtDateTime } from "@/lib/time";
import { resolveReview } from "../actions";

export const metadata = { title: "Possíveis duplicados" };

type Candidate = {
  business_name: string;
  city: string;
  unit_label?: string;
  phone?: string;
  instagram?: string;
  website_url?: string;
  selection_reason?: string;
};

export default async function ReviewsPage() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from("duplicate_reviews")
    .select("*")
    .eq("status", "pendente")
    .order("created_at", { ascending: false })
    .limit(100);
  const ids = [...new Set((data ?? []).flatMap((r) => r.matched_lead_ids as string[]))];
  const { data: matches } = ids.length
    ? await supabase.from("leads").select("id, business_name, city, unit_label, phone_raw, instagram_handle, stage").in("id", ids)
    : { data: [] };
  const byId = new Map((matches ?? []).map((m) => [m.id, m]));

  return (
    <>
      <PageHeader
        title="Possíveis duplicados"
        subtitle="Candidatos que não foram cadastrados automaticamente. Nada é mesclado ou apagado sem a sua decisão."
        actions={<Link href="/leads" className="btn-ghost">Voltar aos leads</Link>}
      />
      {error ? (
        <ErrorBox message={dbErrorMessage(error)} />
      ) : !data?.length ? (
        <Empty title="Nenhum possível duplicado aguardando revisão." />
      ) : (
        <div className="space-y-4">
          {data.map((r) => {
            const c = r.candidate as Candidate;
            return (
              <div key={r.id} className="card grid gap-4 p-4 lg:grid-cols-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-amber-300">
                    {REVIEW_REASON_LABEL[r.reason] ?? r.reason}
                  </div>
                  <h2 className="mt-1 font-semibold">
                    {c.business_name} {c.unit_label && <span className="text-muted">· {c.unit_label}</span>}
                  </h2>
                  <p className="text-sm text-muted">
                    {c.city} · {c.phone ?? "sem telefone"} · {c.instagram ?? "sem Instagram"}
                  </p>
                  {c.selection_reason && <p className="mt-1 text-sm">{c.selection_reason}</p>}
                  <p className="mt-1 text-xs text-muted">
                    Origem: {ORIGIN_LABEL[r.origin as Origin]} · {fmtDateTime(r.created_at)}
                  </p>
                  <div className="mt-3 space-y-1 text-sm">
                    <div className="label">Fichas parecidas</div>
                    {(r.matched_lead_ids as string[]).map((id) => {
                      const m = byId.get(id);
                      return m ? (
                        <Link key={id} href={`/leads/${id}`} className="block hover:text-accent">
                          {m.business_name}
                          {m.unit_label ? ` · ${m.unit_label}` : ""} — {m.city} · {m.phone_raw ?? "—"} ·{" "}
                          {m.instagram_handle ? `@${m.instagram_handle}` : "—"}
                        </Link>
                      ) : null;
                    })}
                  </div>
                </div>
                <div className="space-y-3">
                  <ActionForm action={resolveReview} submit="Vincular à ficha" variant="btn-ghost" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="review_id" value={r.id} />
                    <input type="hidden" name="action" value="vincular" />
                    <select className="input w-auto" name="lead_id" aria-label="Ficha">
                      {(r.matched_lead_ids as string[]).map((id) => (
                        <option key={id} value={id}>{byId.get(id)?.business_name ?? id}</option>
                      ))}
                    </select>
                  </ActionForm>
                  <ActionForm action={resolveReview} submit="Criar como novo lead" variant="btn-ghost" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="review_id" value={r.id} />
                    <input type="hidden" name="action" value="criar_novo" />
                    {r.reason === "instagram_outra_unidade" && (
                      <input className="input w-auto" name="unit_label" placeholder="Nome da unidade" required maxLength={120} />
                    )}
                  </ActionForm>
                  <ActionForm action={resolveReview} submit="Descartar" variant="btn-danger" className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="review_id" value={r.id} />
                    <input type="hidden" name="action" value="descartar" />
                    <input className="input w-auto" name="note" placeholder="Motivo (opcional)" maxLength={1000} />
                  </ActionForm>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
