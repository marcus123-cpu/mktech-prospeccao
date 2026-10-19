"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Ícones de traço (estilo Lucide), todos na mesma cor: o azul da marca marca só o que está aberto.
const ICONS = {
  home: "M3 10.5 12 3l9 7.5V21H3z M9 21v-6h6v6",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  funnel: "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0",
  bot: "M12 8V4H8 M4 8h16v12H4z M2 14h2 M20 14h2 M15 13v2 M9 13v2",
  sliders: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
  send: "m22 2-7 20-4-9-9-4 20-7Z M22 2 11 13",
  chart: "M3 3v18h18 M7 15v3 M12 9v9 M17 5v13",
  plug: "M12 22v-5 M9 8V2 M15 8V2 M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z",
  spark: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z M19 17l.7 1.8L21.5 19.5l-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
} as const;

export const ITEMS = [
  { href: "/conexao", icon: "plug", label: "Conexão", short: "Conexão", title: "Conexão do WhatsApp" },
  { href: "/saude", icon: "chart", label: "Saúde do sistema", short: "Saúde", title: "Saúde do sistema" },
  { href: "/aprendizado", icon: "spark", label: "Aprendizado", short: "Aprender", title: "Aprendizado do Hermes" },
  { href: "/envio", icon: "sliders", label: "Central de envio", short: "Envio", title: "Central de envio" },
  { href: "/disparo", icon: "send", label: "Disparar", short: "Disparar", title: "Disparo de mensagens" },
  { href: "/hermes", icon: "chart", label: "Visão geral", short: "Hermes", title: "Visão geral" },
  { href: "/", icon: "home", label: "Hoje", short: "Hoje", title: "Hoje" },
  { href: "/leads", icon: "users", label: "Leads", short: "Leads", title: "Leads" },
  { href: "/conversas", icon: "chat", label: "Conversas", short: "Conversas", title: "Conversas" },
  { href: "/funil", icon: "funnel", label: "Funil", short: "Funil", title: "Funil de vendas" },
  { href: "/retornos", icon: "bell", label: "Retornos", short: "Retornos", title: "Retornos" },
  { href: "/execucoes", icon: "bot", label: "Pesquisas do Hermes", short: "Hermes", title: "Pesquisas do Hermes" },
  { href: "/configuracoes", icon: "gear", label: "Configurações", short: "Ajustes", title: "Configurações" },
] as const;

/** Título da seção aberta, mostrado na barra superior. */
export function sectionTitle(path: string) {
  const item = ITEMS.filter(i => (i.href === "/" ? path === "/" : path.startsWith(i.href))).sort((a, b) => b.href.length - a.href.length)[0];
  return item?.title ?? "Painel";
}

function Icon({ name, className = "h-[18px] w-[18px]" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {ICONS[name].split(" M").map((d, i) => <path key={i} d={i ? `M${d}` : d} />)}
    </svg>
  );
}

function useActive() {
  const path = usePathname();
  return (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
}

function Badge({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-300" title="possíveis duplicados para revisar">
      {count}
    </span>
  );
}

const GROUPS = [
  { label: "Principal", items: ["/", "/envio", "/leads", "/conversas", "/funil", "/retornos"] },
  { label: "Prospecção", items: ["/hermes", "/execucoes", "/disparo"] },
  { label: "Sistema", items: ["/conexao", "/saude", "/aprendizado", "/configuracoes"] },
];

/** Menu lateral, usado a partir de telas médias. */
export function Nav({ pendingReviews }: { pendingReviews: number }) {
  const active = useActive();
  return (
    <nav className="flex flex-col gap-4 group-data-[compact=true]/side:gap-2">
      {GROUPS.map(group => (
        <div key={group.label}>
          <div className="mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted/70 group-data-[compact=true]/side:hidden">{group.label}</div>
          <div aria-hidden className="mx-3 mb-2 hidden border-t border-line/70 group-data-[compact=true]/side:block" />
          <div className="flex flex-col gap-0.5">
            {group.items.map(href => ITEMS.find(item => item.href === href)!).map(item => {
              const on = active(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  title={item.label}
                  className={`group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[13.5px] transition-colors duration-150 group-data-[compact=true]/side:justify-center group-data-[compact=true]/side:px-0 ${
                    on ? "bg-white font-semibold text-slate-950" : "text-muted hover:bg-white/8 hover:text-slate-100"
                  }`}
                >
                                    <Icon name={item.icon} className={`h-[18px] w-[18px] shrink-0 transition-colors ${on ? "text-slate-950" : "text-muted group-hover:text-slate-200"}`} />
                  <span className="truncate group-data-[compact=true]/side:hidden">{item.label}</span>
                  {item.href === "/leads" && pendingReviews > 0 && <span className="ml-auto group-data-[compact=true]/side:hidden"><Badge count={pendingReviews} /></span>}
                </Link>
              );
            })}
          </div>
        </div>
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-panel/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="grid grid-cols-6">
        {ITEMS.filter((item) => ["/", "/leads", "/envio", "/conversas", "/disparo", "/configuracoes"].includes(item.href)).map((item) => {
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
                <span className={`absolute top-0 h-0.5 rounded-full bg-accent transition-all duration-300 ${on ? "w-8" : "w-0"}`} />
                <Icon name={item.icon} className={`h-5 w-5 ${on ? "text-accent-2" : ""}`} />
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
