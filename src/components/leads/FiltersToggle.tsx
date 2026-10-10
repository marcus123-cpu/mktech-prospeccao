"use client";

import { useState } from "react";

/** No celular os filtros ficam recolhidos atrás de um botão; em telas maiores aparecem sempre. */
export function FiltersToggle({ active, children }: { active: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <button
        type="button"
        className="btn-ghost mb-2 w-full justify-between md:hidden"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          Buscar e filtrar
          {active > 0 && <span className="ml-2 rounded-full bg-accent/20 px-1.5 text-xs text-violet-200">{active}</span>}
        </span>
        <span aria-hidden>{open ? "▲" : "▼"}</span>
      </button>
      <div className={open ? "block" : "hidden md:block"}>{children}</div>
    </div>
  );
}
