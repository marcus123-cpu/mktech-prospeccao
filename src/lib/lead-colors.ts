export const LEAD_COLORS = {
  todos: "border-sky-400/25 bg-sky-500/10 shadow-[inset_0_0_28px_rgba(14,165,233,0.08)]",
  contatados: "border-emerald-400/30 bg-emerald-500/10 shadow-[inset_0_0_28px_rgba(16,185,129,0.10)]",
  novos: "border-red-400/30 bg-red-500/10 shadow-[inset_0_0_28px_rgba(239,68,68,0.10)]",
  sem_numero: "border-orange-400/30 bg-orange-500/10 shadow-[inset_0_0_28px_rgba(249,115,22,0.10)]",
  instagram: "border-fuchsia-400/30 bg-fuchsia-500/10 shadow-[inset_0_0_28px_rgba(217,70,239,0.08)]",
  fixo: "border-amber-400/30 bg-amber-500/10 shadow-[inset_0_0_28px_rgba(245,158,11,0.08)]",
} as const;
export function leadColor(lead: {contacted: boolean; phone_e164: string | null}) {
  return LEAD_COLORS[lead.contacted ? "contatados" : !lead.phone_e164 ? "sem_numero" : "novos"];
}
