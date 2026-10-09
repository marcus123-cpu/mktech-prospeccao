"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LeadFields } from "@/components/leads/LeadForm";
import { REVIEW_REASON_LABEL } from "@/lib/labels";
import { createLead, type CreateState } from "../actions";

export function NewLeadForm() {
  const [state, action, pending] = useActionState<CreateState, FormData>(createLead, {});
  return (
    <form action={action} className="card space-y-4 p-4">
      <LeadFields />
      {state.error && (
        <div role="alert" className="rounded-lg bg-amber-950/50 p-3 text-sm text-amber-200">
          {state.error}
          {state.review && (
            <p className="mt-1">
              Motivo: {REVIEW_REASON_LABEL[state.review.reason] ?? state.review.reason}.{" "}
              <Link href="/leads/duplicados" className="underline">Abrir fila de revisão</Link>
            </p>
          )}
        </div>
      )}
      <button className="btn-primary" disabled={pending}>{pending ? "Salvando…" : "Cadastrar lead"}</button>
    </form>
  );
}
