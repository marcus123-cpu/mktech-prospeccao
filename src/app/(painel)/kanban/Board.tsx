"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { KANBAN_STAGES, type KanbanStage } from "@/lib/kanban";
import { moveCard } from "./actions";

export type Card = { lead_id: string; business_name: string; city: string; state: string | null; niche: string | null; fit_score: number | null; stage: KanbanStage; lists: number };

/** Quadro Kanban: arraste o card ou use o seletor. Etapas sensíveis pedem a confirmação concreta. */
export function Board({ cards }: { cards: Card[] }) {
  const [items, setItems] = useState(cards);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function move(card: Card, stage: KanbanStage) {
    if (card.stage === stage) return;
    const payload: Parameters<typeof moveCard>[0] = { lead_id: card.lead_id, stage };
    if (stage === "fechado") {
      const value = window.prompt("Valor fechado e confirmado (R$):");
      if (value === null) return;
      const date = window.prompt("Data do fechamento (AAAA-MM-DD):", new Date().toISOString().slice(0, 10));
      if (date === null) return;
      const note = window.prompt("Confirmação (ex.: pagamento recebido, contrato assinado):") ?? "";
      payload.value = Number(value.replace(",", ".")); payload.closed_at = date; payload.note = note;
    } else if (stage === "perdido") {
      const reason = window.prompt("Motivo da perda:");
      if (!reason) return;
      payload.note = reason;
    } else if (stage === "nao_contatar") {
      if (!window.confirm("Marcar como NÃO CONTATAR bloqueia o lead e cancela mensagens na fila. Continuar?")) return;
    }
    const before = items;
    setItems((cur) => cur.map((c) => (c.lead_id === card.lead_id ? { ...c, stage } : c)));
    setError(null);
    start(async () => {
      const r = await moveCard(payload);
      if (r.error) { setItems(before); setError(r.error); }
    });
  }

  return (
    <div>
      {error && <p role="alert" className="mb-2 rounded border border-rose-500/40 p-2 text-sm text-rose-300">{error}</p>}
      <div className={`flex gap-3 overflow-x-auto pb-3 ${pending ? "opacity-80" : ""}`}>
        {KANBAN_STAGES.map((col) => {
          const list = items.filter((c) => c.stage === col.key);
          return (
            <section
              key={col.key}
              className={`card w-64 shrink-0 border-t-4 p-2 ${col.tone}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("text/plain");
                const card = items.find((c) => c.lead_id === id);
                if (card) move(card, col.key);
              }}
            >
              <h2 className="mb-2 flex items-center justify-between text-sm font-semibold">{col.title}<span className="text-xs text-muted">{list.length}</span></h2>
              <ul className="max-h-[70vh] min-h-12 space-y-2 overflow-y-auto">
                {list.slice(0, 100).map((c) => (
                  <li key={c.lead_id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", c.lead_id)} className="cursor-grab rounded border border-white/10 bg-black/20 p-2 text-sm">
                    <Link href={`/leads/${c.lead_id}`} className="font-medium underline">{c.business_name}</Link>
                    <p className="text-xs text-muted">{c.city}{c.state ? `/${c.state}` : ""}{c.niche ? ` · ${c.niche}` : ""} · nota {c.fit_score ?? "—"}</p>
                    <select aria-label="Mover para" value={c.stage} onChange={(e) => move(c, e.target.value as KanbanStage)} className="input mt-1 w-full text-xs">
                      {KANBAN_STAGES.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
                    </select>
                  </li>
                ))}
                {list.length > 100 && <li className="text-xs text-muted">+{list.length - 100} (use os filtros em Leads)</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
