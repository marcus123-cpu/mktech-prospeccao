import { BottomNav, Nav } from "@/components/Nav";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BotChip } from "@/components/BotChip";
import { requireAdmin } from "@/lib/auth";
import { PanelShell } from "@/components/PanelShell";
import { ConversationNotifications } from "@/components/ConversationNotifications";
import { Suspense } from "react";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireAdmin();
  const [{ count }, { data: bot }] = await Promise.all([
    supabase.from("duplicate_reviews").select("id", { count: "exact", head: true }).eq("status", "pendente"),
    supabase.from("outreach_settings").select("enabled, paused").eq("id", 1).maybeSingle(),
  ]);
  const chip = <BotChip enabled={bot?.enabled ?? false} paused={bot?.paused ?? false} />;

  return (
    <>
      <AutoRefresh />
      <Suspense fallback={null}><ConversationNotifications /></Suspense>
      <PanelShell mobileHeader={
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line/70 bg-panel px-4 py-3 md:hidden">
        <div>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mk.png" alt="MKTech Dev" width={44} height={21} className="h-[21px] w-11 object-contain" />
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">MKTech Dev</div>
              <div className="text-sm font-semibold">Prospecção 🤖</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 pr-12">
          {chip}
          <form action="/auth/sair" method="post">
            <button className="rounded-lg px-3 py-2 text-sm text-muted hover:text-slate-200">Sair</button>
          </form>
        </div>
      </header>}

      topbar={<>
        {chip}
        <a href="/configuracoes" title="Configurações" aria-label="Configurações" className="flex h-10 w-10 items-center justify-center rounded-full bg-panel-2 text-muted transition hover:bg-white/15 hover:text-white">
          <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
        </a>
        <span title={user.email ?? ""} className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-sm font-bold uppercase text-white">{(user.email ?? "M")[0]}</span>
      </>}

      sidebar={<Nav pendingReviews={count ?? 0} />}

      bottomNav={<BottomNav pendingReviews={count ?? 0} />}>{children}</PanelShell>
    </>
  );
}
