import { BottomNav, Nav } from "@/components/Nav";
import { requireAdmin } from "@/lib/auth";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireAdmin();
  const { count } = await supabase
    .from("duplicate_reviews")
    .select("id", { count: "exact", head: true })
    .eq("status", "pendente");

  return (
    <div className="md:flex">
      {/* Celular: cabeçalho compacto no topo e menu em abas no rodapé. */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-panel/95 px-4 py-3 backdrop-blur md:hidden">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">MKTech Dev</div>
          <div className="text-sm font-semibold">Prospecção</div>
        </div>
        <form action="/auth/sair" method="post">
          <button className="rounded-lg px-3 py-2 text-sm text-muted hover:text-slate-200">Sair</button>
        </form>
      </header>

      <aside className="hidden md:sticky md:top-0 md:block md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-r md:border-line md:bg-panel md:px-4 md:py-6">
        <div className="mb-8">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">MKTech Dev</div>
          <div className="text-sm font-semibold">Prospecção</div>
        </div>
        <Nav pendingReviews={count ?? 0} />
        <div className="mt-8 border-t border-line pt-4">
          <div className="truncate text-xs text-muted" title={user.email ?? ""}>{user.email}</div>
          <form action="/auth/sair" method="post">
            <button className="mt-2 text-sm text-muted hover:text-slate-200">Sair</button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-28 pt-5 md:px-8 md:py-6">{children}</main>
      <BottomNav pendingReviews={count ?? 0} />
    </div>
  );
}
