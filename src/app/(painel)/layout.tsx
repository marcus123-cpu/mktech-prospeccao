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
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-panel/95 px-4 py-3 backdrop-blur md:hidden">
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
        <div className="flex items-center gap-1">
          {chip}
          <form action="/auth/sair" method="post">
            <button className="rounded-lg px-3 py-2 text-sm text-muted hover:text-slate-200">Sair</button>
          </form>
        </div>
      </header>}

      sidebar={<>
        <div className="mb-5 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="MKTech Dev" width={640} height={401} className="mx-auto w-28 max-w-full" />
          <div className="mt-1 text-sm font-semibold">Prospecção 🤖</div>
        </div>
        <div className="mb-4">{chip}</div>
        <Nav pendingReviews={count ?? 0} />
        <div className="mt-8 border-t border-line pt-4">
          <div className="truncate text-xs text-muted" title={user.email ?? ""}>{user.email}</div>
          <form action="/auth/sair" method="post">
            <button className="mt-2 text-sm text-muted hover:text-slate-200">Sair</button>
          </form>
        </div>
      </>}

      bottomNav={<BottomNav pendingReviews={count ?? 0} />}>{children}</PanelShell>
    </>
  );
}
