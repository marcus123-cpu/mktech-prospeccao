"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Hoje", short: "Hoje", hint: "o que fazer agora", mobile: true },
  { href: "/leads", label: "Leads", short: "Leads", hint: "todos os contatos", mobile: true },
  { href: "/funil", label: "Funil", short: "Funil", hint: "envio, conversa e fechamento", mobile: true },
  { href: "/retornos", label: "Retornos", short: "Retornos", hint: "quem chamar de novo", mobile: false },
  { href: "/envio", label: "Envio automático", short: "Envio", hint: "WhatsApp e respostas", mobile: true },
  { href: "/execucoes", label: "Pesquisas do Hermes", short: "Hermes", hint: "o que o robô fez", mobile: false },
  { href: "/configuracoes", label: "Configurações", short: "Ajustes", hint: "metas, cidades, token", mobile: true },
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
            active(item.href) ? "bg-accent/15 font-medium text-white" : "text-muted hover:bg-panel-2 hover:text-slate-200"
          }`}
        >
          {item.label}
          {item.href === "/leads" && pendingReviews > 0 && (
            <span className="ml-2">
              <Badge count={pendingReviews} />
            </span>
          )}
          <span className="block text-xs font-normal text-muted">{item.hint}</span>
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
                <span className={`h-1 w-6 rounded-full ${on ? "bg-accent" : "bg-transparent"}`} />
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
