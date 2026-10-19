"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startDispatch } from "@/app/(painel)/disparo/actions";
import { type DispatchAlert, dismissDispatchAlert, persistDispatchAlert, readDispatchAlerts, writeDispatchAlerts } from "@/lib/dispatch-alerts";

export function DispatchNotification({ alert, onDismiss }: { alert: DispatchAlert; onDismiss?: (id: string) => void }) {
  const router = useRouter();
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const dismiss = () => { writeDispatchAlerts(readDispatchAlerts().filter(row => row.id !== alert.id)); onDismiss?.(alert.id); void dismissDispatchAlert(alert.id); };
  async function retry() {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    const form = new FormData();
    form.set("scope", alert.recovery === "all" ? "all" : alert.scope);
    form.set("today", alert.today);
    for (const id of alert.leads) form.append("lead_ids", id);
    try {
      const result = await startDispatch({}, form);
      if (result.error) {
        const updated = { ...alert, message: result.error!, recovery: result.recovery ?? "review" };
        writeDispatchAlerts(readDispatchAlerts().map(row => row.id === alert.id ? updated : row));
        void persistDispatchAlert(updated);
      } else {
        dismiss();
        router.refresh();
        router.push("/disparo");
      }
    } catch {
      writeDispatchAlerts(readDispatchAlerts().map(row => row.id === alert.id ? { ...row, recovery: "review", message: "Resultado do disparo não confirmado. Confira o histórico antes de tentar novamente, para evitar envio duplicado." } : row));
    } finally { locked.current = false; setPending(false); }
  }
  return <article className="mb-3 rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-sm">
    <strong className="text-rose-200">{alert.recovery === "review" ? "Confira o disparo" : "Disparo não iniciado"}</strong>
    <p className="mt-1 whitespace-pre-wrap break-words">{alert.message}</p>
    {alert.recovery === "all" && <p className="mt-2 text-xs text-amber-200">Fazer mesmo assim usará TODOS os leads novos disponíveis, inclusive fora dos filtros da lista. Limite de hoje: {alert.today}. Bloqueados e já contatados continuam de fora.</p>}
    {alert.recovery === "retry" && <p className="mt-2 text-xs text-[#aebac1]">Tenta novamente a mesma seleção após você corrigir o motivo acima. As regras de envio continuam valendo.</p>}
    <div className="mt-3 flex flex-wrap gap-3">
      {alert.recovery !== "review" && <button disabled={pending} className="font-semibold text-emerald-300 disabled:opacity-50" onClick={() => void retry()}>{pending ? "Verificando…" : alert.recovery === "all" ? "Fazer mesmo assim" : "Tentar novamente"}</button>}
      <Link href="/disparo" className="text-emerald-300">Conferir disparos</Link>
      <button disabled={pending} onClick={dismiss} className="disabled:opacity-50">Cancelar tentativa</button>
    </div>
  </article>;
}
