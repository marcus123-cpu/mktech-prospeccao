"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/** Busca de nicho que atualiza a lista enquanto você digita (com uma pausa curta para não pesar). */
export function LiveSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  const last = useRef(initial);
  useEffect(() => {
    if (value === last.current) return;
    const timer = window.setTimeout(() => {
      last.current = value;
      const term = value.trim();
      start(() => router.replace(term ? `/leads?busca=${encodeURIComponent(term)}` : "/leads", { scroll: false }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [value, router]);
  return (
    <div className="relative min-w-0 flex-1">
      <input name="busca" value={value} onChange={e => setValue(e.target.value)} autoComplete="off" className="input w-full" placeholder="🔎 Buscar nicho (ex.: massagem, massoterapia ou massoterapeuta)" aria-label="Buscar nicho" />
      {pending && <span aria-hidden className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-white/20 border-t-accent" />}
    </div>
  );
}
