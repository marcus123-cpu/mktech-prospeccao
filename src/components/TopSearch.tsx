"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Busca de nicho da barra superior: leva para Leads e filtra enquanto você digita. */
export function TopSearch() {
  const router = useRouter();
  const path = usePathname();
  const onLeads = path === "/leads";
  const current = useSearchParams().get("busca") ?? "";
  const [value, setValue] = useState(onLeads ? current : "");
  const last = useRef(value);
  useEffect(() => {
    if (value === last.current) return;
    const timer = window.setTimeout(() => {
      last.current = value;
      const term = value.trim();
      const url = term ? `/leads?busca=${encodeURIComponent(term)}` : "/leads";
      // Já em Leads só troca a busca; vindo de outra aba, abre Leads uma vez.
      if (onLeads) router.replace(url, { scroll: false }); else if (term) router.push(url);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [value, onLeads, router]);
  return (
    <div className="relative w-full max-w-xs">
      <svg aria-hidden viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input value={value} onChange={e => setValue(e.target.value)} autoComplete="off" placeholder="Buscar nicho…" aria-label="Buscar nicho" className="input !rounded-full !bg-panel-2 !py-2.5 !pl-10" />
    </div>
  );
}
