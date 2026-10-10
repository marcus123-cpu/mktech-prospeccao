import { PRIORITY_LABEL, SITE_LABEL, STAGE_COLOR, STAGE_LABEL, type Priority, type SiteStatus, type Stage } from "@/lib/labels";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 md:mb-6">
      <div>
        <h1 className="text-xl font-semibold md:text-2xl">{title}</h1>
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
  if (!contacted) return <span className="badge bg-slate-800 text-slate-400">Não contatado</span>;
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
    <div className="card p-6 text-center md:p-10">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">
      {message}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
