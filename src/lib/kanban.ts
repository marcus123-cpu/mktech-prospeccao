export const KANBAN_STAGES = [
  { key: "novo", title: "Novo", tone: "border-slate-400" },
  { key: "na_lista", title: "Na lista", tone: "border-sky-400" },
  { key: "contatado", title: "Contatado", tone: "border-indigo-400" },
  { key: "aguardando_resposta", title: "Aguardando resposta", tone: "border-cyan-400" },
  { key: "respondeu", title: "Respondeu", tone: "border-teal-400" },
  { key: "interessado", title: "Interessado", tone: "border-violet-400" },
  { key: "proposta_enviada", title: "Proposta enviada", tone: "border-amber-400" },
  { key: "negociacao", title: "Negociação", tone: "border-orange-400" },
  { key: "fechado", title: "Fechado", tone: "border-emerald-400" },
  { key: "perdido", title: "Perdido", tone: "border-zinc-400" },
  { key: "nao_contatar", title: "Não contatar", tone: "border-rose-400" },
] as const;
export type KanbanStage = (typeof KANBAN_STAGES)[number]["key"];
export const KANBAN_KEYS = KANBAN_STAGES.map((s) => s.key) as unknown as [KanbanStage, ...KanbanStage[]];
