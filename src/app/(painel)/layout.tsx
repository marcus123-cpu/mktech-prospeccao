import { Nav } from "@/components/Nav";
import { requireAdmin } from "@/lib/auth";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireAdmin();
  const { count } = await supabase
    .from("duplicate_reviews")
    .select("id", { count: "exact", head: true })
    .eq("status", "pendente");

  return (
    <div className="md:flex">
      <aside className="border-b border-line bg-panel px-3 py-3 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r md:px-4 md:py-6">
        <div className="mb-3 flex items-center justify-between md:mb-8 md:block">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">MKTech Dev</div>
            <div className="text-sm font-semibold">Prospecção</div>
          </div>
          <form action="/auth/sair" method="post" className="md:hidden">
            <button className="text-xs text-muted hover:text-slate-200">Sair</button>
          </form>
        </div>
        <Nav pendingReviews={count ?? 0} />
        <div className="mt-8 hidden border-t border-line pt-4 md:block">
          <div className="truncate text-xs text-muted" title={user.email ?? ""}>{user.email}</div>
          <form action="/auth/sair" method="post">
            <button className="mt-2 text-sm text-muted hover:text-slate-200">Sair</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
