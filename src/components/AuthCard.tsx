export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">MKTech Dev</div>
          <h1 className="mt-1 text-xl font-semibold">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}
