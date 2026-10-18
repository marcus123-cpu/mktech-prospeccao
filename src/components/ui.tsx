import { PRIORITY_LABEL, SITE_LABEL, STAGE_COLOR, STAGE_LABEL, type Priority, type SiteStatus, type Stage } from "@/lib/labels";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-l-4 border-accent pl-3 pr-12 md:mb-6">
      <div>
        <h1 className="text-gradient text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
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
        : "bg-accent/15 text-violet-200";
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

const STAT_TONES = [
  "from-violet-500/20 before:bg-violet-400",
  "from-sky-500/20 before:bg-sky-400",
  "from-emerald-500/20 before:bg-emerald-400",
  "from-amber-500/20 before:bg-amber-400",
  "from-rose-500/20 before:bg-rose-400",
  "from-cyan-500/20 before:bg-cyan-400",
  "from-fuchsia-500/20 before:bg-fuchsia-400",
];

/** Cada indicador ganha uma cor própria, sempre a mesma para o mesmo nome. */
export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  const tone = STAT_TONES[[...label].reduce((n, ch) => n + ch.charCodeAt(0), 0) % STAT_TONES.length];
  return (
    <div className={`card card-hover relative overflow-hidden bg-gradient-to-br ${tone} to-panel/80 p-4 before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-full`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-300/80">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
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
    <details open={open} className={`card group p-4 open:shadow-[0_12px_30px_-14px_rgb(124_108_255/0.3)] ${tone ?? ""}`}>
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
