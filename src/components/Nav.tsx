"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Hoje", hint: "o que fazer agora" },
  { href: "/leads", label: "Leads", hint: "todos os contatos" },
  { href: "/retornos", label: "Retornos", hint: "quem chamar de novo" },
  { href: "/execucoes", label: "Pesquisas do Hermes", hint: "o que o robô fez" },
  { href: "/configuracoes", label: "Configurações", hint: "metas, cidades, token" },
];

export function Nav({ pendingReviews }: { pendingReviews: number }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
            active(item.href) ? "bg-accent/15 font-medium text-white" : "text-muted hover:bg-panel-2 hover:text-slate-200"
          }`}
        >
          {item.label}
          {item.href === "/leads" && pendingReviews > 0 && (
            <span className="ml-2 rounded-full bg-amber-500/20 px-1.5 text-xs text-amber-300" title="possíveis duplicados para revisar">
              {pendingReviews}
            </span>
          )}
          <span className="hidden text-xs font-normal text-muted md:block">{item.hint}</span>
        </Link>
      ))}
    </nav>
  );
}
