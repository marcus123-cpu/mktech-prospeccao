"use client";

export default function PainelError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card p-8 text-center">
      <p className="font-medium">Não foi possível carregar esta página.</p>
      <p className="mt-1 text-sm text-muted">Verifique a conexão com o Supabase e tente de novo.</p>
      <button onClick={reset} className="btn-ghost mt-4">Tentar novamente</button>
    </div>
  );
}
