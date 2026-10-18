import { PRIORITY_LABEL, SITE_LABEL, STAGE_COLOR, STAGE_LABEL, type Priority, type SiteStatus, type Stage } from "@/lib/labels";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 md:mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
    </div>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  return <span className={`badge ${STAGE_COLOR[stage]}`}>{STAGE_LABEL[stage]}</span>;
}

export function ContactBadge({ contacted, unknownDate }: { contacted: boolean; unknownDate?: boolean }) {
  if (!contacted) return <span className="badge bg-red-500/15 text-red-300">Não contatado</span>;
  return (
    <span className="badge bg-emerald-950 text-emerald-300" title={unknownDate ? "Contato importado sem data" : undefined}>
      Contatado{unknownDate ? " (sem data)" : ""}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const color = priority === "alta" ? "text-rose-300" : priority === "media" ? "text-amber-300" : "text-slate-400";
  return <span className={`text-xs font-medium ${color}`}>{PRIORITY_LABEL[priority]}</span>;
}

export function SiteBadge({ status }: { status: SiteStatus }) {
  const color =
    status === "site_proprio_encontrado"
      ? "bg-slate-800 text-slate-300"
      : status === "verificacao_pendente"
        ? "bg-zinc-800 text-zinc-400"
        : "bg-accent/15 text-blue-200";
  return <span className={`badge ${color}`}>{SITE_LABEL[status]}</span>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card animate-fade p-6 text-center md:p-10">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="animate-pop rounded-2xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">
      {message}
    </div>
  );
}

/** Indicador de CRM: o primeiro de cada grade pode ser "destaque" (cartão branco, como na referência). */
export function Stat({ label, value, hint, highlight }: { label: string; value: React.ReactNode; hint?: string; highlight?: boolean }) {
  return (
    <div className={`card card-hover flex min-h-32 flex-col justify-between p-5 ${highlight ? "!border-transparent !bg-white !text-slate-900 hover:!bg-white" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`text-sm ${highlight ? "text-slate-700" : "text-slate-300"}`}>{label}</div>
        <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs ${highlight ? "bg-accent text-white" : "bg-white/10 text-slate-300"}`}>↗</span>
      </div>
      <div>
        <div className={`mt-4 text-3xl font-semibold tabular-nums tracking-tight ${highlight ? "text-slate-950" : "text-white"}`}>{value}</div>
        {hint && <div className={`mt-1 text-xs ${highlight ? "text-slate-500" : "text-muted"}`}>{hint}</div>}
      </div>
    </div>
  );
}

/** Seção que abre e fecha com a setinha; começa fechada para a página não ficar cheia. */
export function Fold({
  title,
  count,
  hint,
  open = false,
  tone,
  children,
}: {
  title: React.ReactNode;
  count?: number;
  hint?: string;
  open?: boolean;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className={`card group p-4 ${tone ?? ""}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block text-muted transition-transform group-open:rotate-90">▶</span>
        <span>{title}</span>
        {count !== undefined && <span className="badge bg-panel-2 text-slate-300">{count}</span>}
        {hint && <span className="ml-auto hidden text-xs font-normal text-muted sm:inline">{hint}</span>}
      </summary>
      <div className="mt-3 animate-fade">{children}</div>
    </details>
  );
}
