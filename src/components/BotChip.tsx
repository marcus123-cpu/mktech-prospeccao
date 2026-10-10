import Link from "next/link";

/** Estado da chave global do envio automático, visível em todas as telas. */
export function BotChip({ enabled, paused }: { enabled: boolean; paused: boolean }) {
  const [label, tone] = !enabled
    ? ["Bot desligado", "bg-slate-800 text-slate-300"]
    : paused
      ? ["Bot pausado", "bg-amber-500/20 text-amber-200"]
      : ["Bot ligado", "bg-emerald-900/70 text-emerald-200"];
  return (
    <Link href="/envio" className={`badge py-1 ${tone}`} title="Chave do envio automático de WhatsApp (clique para ligar, pausar ou desligar)">
      <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-current" />
      {label}
    </Link>
  );
}
