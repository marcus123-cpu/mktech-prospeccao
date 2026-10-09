"use client";

import { useEffect, useState } from "react";

type Tab = { key: string; label: string; badge?: string | null; content: React.ReactNode };

/** Abas simples; a aba aberta fica na URL (#abordagem) para sobreviver ao recarregar. */
export function LeadTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0].key);
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (tabs.some((t) => t.key === hash)) setActive(hash);
  }, [tabs]);

  return (
    <div>
      <div role="tablist" className="mb-3 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={active === t.key}
            onClick={() => {
              setActive(t.key);
              history.replaceState(null, "", `#${t.key}`);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              active === t.key ? "border-accent text-slate-100" : "border-transparent text-muted hover:text-slate-200"
            }`}
          >
            {t.label}
            {t.badge && <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300">{t.badge}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" hidden={active !== t.key}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
