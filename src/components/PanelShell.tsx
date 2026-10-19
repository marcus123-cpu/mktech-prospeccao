"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { TopSearch } from "./TopSearch";
import { usePathname } from "next/navigation";
import { sectionTitle } from "./Nav";

const KEY = "mktech:menu:collapsed:v1";

/** Keeps navigation available while giving conversations the full viewport. */
export function PanelShell({ sidebar, mobileHeader, topbar, bottomNav, children }: {
  sidebar: ReactNode; mobileHeader: ReactNode; topbar: ReactNode; bottomNav: ReactNode; children: ReactNode;
}) {
  const pathname = usePathname();
  const conversations = pathname.startsWith("/conversas");
  const [collapsed, setCollapsed] = useState(true);
  // Barra fina no topo enquanto a próxima tela carrega: o clique responde na hora.
  const [navigating, setNavigating] = useState(false);
  useEffect(() => {
    const start = () => setNavigating(true);
    window.addEventListener("mktech:nav-start", start);
    return () => window.removeEventListener("mktech:nav-start", start);
  }, []);
  useEffect(() => { setNavigating(false); }, [pathname]);
  useEffect(() => {
    if (!navigating) return;
    const timer = window.setTimeout(() => setNavigating(false), 15000);
    return () => window.clearTimeout(timer);
  }, [navigating]);
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
    {navigating && <div aria-hidden className="fixed inset-x-0 top-0 z-[80] h-0.5 overflow-hidden bg-accent/20"><div className="h-full w-1/3 animate-bar rounded-full bg-gradient-to-r from-accent to-accent-2" /></div>}
    {mobileHeader}
    <aside className={`hidden md:sticky md:top-0 md:flex md:h-dvh md:shrink-0 md:flex-col md:overflow-hidden md:border-r group/side ${conversations ? "border-white/5 bg-[#202c33]" : "border-line/70 bg-panel"} transition-[width] duration-300 ease-out ${collapsed ? "md:w-[76px]" : "md:w-60"}`} aria-label="Navegação do painel" data-compact={collapsed}>
      <div className={`flex h-16 shrink-0 items-center ${collapsed ? "justify-center" : "justify-between pl-5 pr-3"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mk.png" alt="MKTech" width={44} height={21} className="h-7 w-14 shrink-0 object-contain" />
        {!collapsed && <div className="mr-auto ml-2.5 min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold tracking-tight">MKTech <span className="text-accent-2">Dev</span></div>
          <div className="truncate text-[10.5px] text-muted">Prospecção</div>
        </div>}
        {!collapsed && <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-controls="panel-navigation" aria-label="Recolher menu principal" title="Recolher menu principal"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/8 text-muted transition hover:bg-white/15 hover:text-white">«</button>}
      </div>
      {collapsed && <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-controls="panel-navigation" aria-label="Abrir menu principal" title="Abrir menu principal"
        className="mx-auto mb-2 flex h-7 w-10 items-center justify-center rounded-full bg-white/8 text-xs text-muted transition hover:bg-white/15 hover:text-white">»</button>}
      <div id="panel-navigation" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">{sidebar}</div>
      <form action="/auth/sair" method="post" className={`shrink-0 pb-4 ${collapsed ? "flex justify-center" : "px-3"}`}>
        <button title="Sair" aria-label="Sair" className={`flex items-center gap-3 rounded-2xl bg-white/8 text-sm text-muted transition hover:bg-white/15 hover:text-white ${collapsed ? "h-11 w-11 justify-center" : "w-full px-3 py-2.5"}`}>
          <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          {!collapsed && "Sair"}
        </button>
      </form>
    </aside>
    <div className="min-w-0 flex-1 md:flex md:min-h-dvh md:flex-col">
    {!conversations && <header className="sticky top-0 z-20 hidden h-16 shrink-0 items-center gap-4 bg-bg px-8 md:flex">
      <Suspense fallback={<div className="w-full max-w-xs" />}><TopSearch /></Suspense>
      <div className="hidden text-sm font-semibold text-slate-200 lg:block">{sectionTitle(pathname)}</div>
      <div className="ml-auto flex items-center gap-3 pr-14">{topbar}</div>
    </header>}
    <main className={conversations ? "h-[calc(100dvh-176px)] min-h-[360px] min-w-0 flex-1 overflow-hidden md:h-dvh md:min-h-0" : "min-w-0 flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-6"}>{conversations ? children : <div key={pathname} className="page-enter mx-auto max-w-[1400px]">{children}</div>}</main>
    </div>
    {bottomNav}
  </div>;
}
