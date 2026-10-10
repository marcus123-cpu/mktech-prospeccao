import Link from "next/link";
import type { PeriodKey } from "@/lib/time";

const OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
];

export function PeriodFilter({ current, start, end }: { current: PeriodKey; start: string; end: string }) {
  return (
    <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
      <div className="flex w-full gap-2 sm:w-auto">
        {OPTIONS.map((o) => (
          <Link
            key={o.key}
            href={`/?periodo=${o.key}`}
            className={`${current === o.key ? "btn-primary" : "btn-ghost"} flex-1 sm:flex-none`}
          >
            {o.label}
          </Link>
        ))}
      </div>
      <form className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 sm:flex sm:w-auto" action="/">
        <input type="hidden" name="periodo" value="personalizado" />
        <div className="min-w-0">
          <label className="label" htmlFor="inicio">De</label>
          <input className="input" type="date" id="inicio" name="inicio" defaultValue={start} required />
        </div>
        <div className="min-w-0">
          <label className="label" htmlFor="fim">Até</label>
          <input className="input" type="date" id="fim" name="fim" defaultValue={end} required />
        </div>
        <button className={current === "personalizado" ? "btn-primary" : "btn-ghost"}>Aplicar</button>
      </form>
    </div>
  );
}
