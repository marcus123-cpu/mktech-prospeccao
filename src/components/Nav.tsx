"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Cada aba tem um emoji e uma cor própria (dot = bolinha/ícone, on = fundo quando está aberta).
const ITEMS = [
  { href: "/", emoji: "🏠", label: "Hoje", short: "Hoje", hint: "o que fazer agora", mobile: true, on: "bg-violet-500/20", bar: "bg-violet-400" },
  { href: "/leads", emoji: "👥", label: "Leads", short: "Leads", hint: "todos os contatos", mobile: true, on: "bg-sky-500/20", bar: "bg-sky-400" },
  { href: "/funil", emoji: "🎯", label: "Funil", short: "Funil", hint: "envio, conversa e fechamento", mobile: true, on: "bg-teal-500/20", bar: "bg-teal-400" },
  { href: "/retornos", emoji: "🔔", label: "Retornos", short: "Retornos", hint: "quem chamar de novo", mobile: false, on: "bg-amber-500/20", bar: "bg-amber-400" },
  { href: "/envio", emoji: "💬", label: "Envio automático", short: "Envio", hint: "WhatsApp e respostas", mobile: true, on: "bg-emerald-500/20", bar: "bg-emerald-400" },
  { href: "/execucoes", emoji: "🤖", label: "Pesquisas do Hermes", short: "Hermes", hint: "o que o robô fez", mobile: false, on: "bg-fuchsia-500/20", bar: "bg-fuchsia-400" },
  { href: "/configuracoes", emoji: "⚙️", label: "Configurações", short: "Ajustes", hint: "metas, cidades, token", mobile: true, on: "bg-slate-500/25", bar: "bg-slate-300" },
];

function useActive() {
  const path = usePathname();
  return (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
}

function Badge({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-amber-500/20 px-1.5 text-xs text-amber-300" title="possíveis duplicados para revisar">
      {count}
    </span>
  );
}

/** Menu lateral, usado a partir de telas médias. */
export function Nav({ pendingReviews }: { pendingReviews: number }) {
  const active = useActive();
  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`rounded-lg px-3 py-2 text-sm transition ${
            active(item.href) ? `${item.on} font-medium text-white` : "text-muted hover:bg-panel-2 hover:text-slate-200"
          }`}
        >
          <span aria-hidden className="mr-2">{item.emoji}</span>
          {item.label}
          {item.href === "/leads" && pendingReviews > 0 && (
            <span className="ml-2">
              <Badge count={pendingReviews} />
            </span>
          )}
          <span className="block pl-7 text-xs font-normal text-muted">{item.hint}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Barra de abas fixa no rodapé, usada no celular. Retornos e Pesquisas ficam acessíveis pela tela Hoje. */
export function BottomNav({ pendingReviews }: { pendingReviews: number }) {
  const active = useActive();
  return (
    <nav
      aria-label="Menu principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        {ITEMS.filter((item) => item.mobile).map((item) => {
          const on = active(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-tight transition ${
                  on ? "font-semibold text-white" : "text-muted"
                }`}
              >
                <span className={`h-1 w-6 rounded-full ${on ? item.bar : "bg-transparent"}`} />
                <span aria-hidden className="text-base leading-none">{item.emoji}</span>
                <span className="truncate">{item.short}</span>
                {item.href === "/leads" && pendingReviews > 0 && (
                  <span className="absolute right-2 top-1.5">
                    <Badge count={pendingReviews} />
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
