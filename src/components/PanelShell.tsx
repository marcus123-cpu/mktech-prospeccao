"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

const KEY = "mktech:menu:collapsed:v1";

/** Keeps navigation available while giving conversations the full viewport. */
export function PanelShell({ sidebar, mobileHeader, bottomNav, children }: {
  sidebar: ReactNode; mobileHeader: ReactNode; bottomNav: ReactNode; children: ReactNode;
}) {
  const pathname = usePathname();
  const conversations = pathname.startsWith("/conversas");
  const [collapsed, setCollapsed] = useState(conversations);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved !== null) setCollapsed(saved === "1");
    } catch { /* The menu remains usable without browser storage. */ }
  }, []);
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* optional preference */ }
  }
  return <div className={conversations ? "conversation-workspace md:flex md:h-dvh md:overflow-hidden" : "md:flex"}>
    {mobileHeader}
    <aside className={`hidden md:sticky md:top-0 md:flex md:h-dvh md:shrink-0 md:flex-col md:overflow-hidden md:border-r ${conversations ? "border-white/5 bg-[#202c33]" : "border-line bg-panel"} ${collapsed ? "md:w-14" : "md:w-60"}`} aria-label="Navegação do painel">
      <div className={`flex h-16 shrink-0 items-center ${collapsed ? "justify-center" : "justify-between px-4"}`}>
        {!collapsed && <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">MKTech · Painel</span>}
        <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-controls="panel-navigation"
          aria-label={collapsed ? "Abrir menu principal" : "Recolher menu principal"}
          title={collapsed ? "Abrir menu principal" : "Recolher menu principal"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#aebac1] transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" />
            <path d={collapsed ? "m13 9 3 3-3 3" : "m17 9-3 3 3 3"} />
          </svg>
        </button>
      </div>
      <div id="panel-navigation" hidden={collapsed} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{sidebar}</div>
      {collapsed && <span className="mb-5 mt-auto text-center text-[10px] font-bold tracking-wider text-[#8696a0]" aria-hidden="true">MK</span>}
    </aside>
    <main className={conversations ? "h-[calc(100dvh-176px)] min-h-[360px] min-w-0 flex-1 overflow-hidden md:h-dvh md:min-h-0" : "min-w-0 flex-1 px-4 pb-28 pt-5 md:px-8 md:py-6"}>{children}</main>
    {bottomNav}
  </div>;
}
