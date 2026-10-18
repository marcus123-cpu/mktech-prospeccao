export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card animate-pop w-full max-w-sm p-6 shadow-[0_20px_60px_-20px_rgb(124_108_255/0.45)]">
        <div className="mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="MKTech Dev" width={640} height={401} className="mx-auto mb-2 w-44" />
          <h1 className="mt-1 text-xl font-semibold">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}
