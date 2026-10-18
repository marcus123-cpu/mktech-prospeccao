"use client";

import { useActionState, useState } from "react";
import { MAX_TARGET, RESEARCH_DEFAULTS, UFS, UF_NAME } from "@/lib/research";
import { cancelSearch, interruptSearch, requestSearch, type PedidoState } from "./actions";

/** Nova pesquisa: nicho livre, localização (Brasil inteiro por padrão) e meta de leads novos (100 por padrão). */
export function RequestSearchForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<PedidoState, FormData>(requestSearch, {});
  const [scope, setScope] = useState<string>(RESEARCH_DEFAULTS.scope);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block text-xs text-muted">Nicho</span>
        <input name="niche" required minLength={2} maxLength={100} defaultValue={RESEARCH_DEFAULTS.niche} placeholder="Ex.: Academia, Barbearia, Oficina Mecânica" className="input w-full" disabled={disabled || pending} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Localização</span>
        <select name="scope" value={scope} onChange={(e) => setScope(e.target.value)} className="input w-full" disabled={disabled || pending}>
          <option value="brasil">Brasil inteiro</option>
          <option value="estado">Estado específico</option>
          <option value="cidade">Cidade específica</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Quantidade de leads novos (meta)</span>
        <input name="target" type="number" min={1} max={MAX_TARGET} step={1} defaultValue={RESEARCH_DEFAULTS.target} className="input w-full" disabled={disabled || pending} />
      </label>
      {scope !== "brasil" && (
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Estado</span>
          <select name="state" required defaultValue="" className="input w-full" disabled={disabled || pending}>
            <option value="" disabled>Escolha…</option>
            {UFS.map((uf) => <option key={uf} value={uf}>{UF_NAME[uf]} ({uf})</option>)}
          </select>
        </label>
      )}
      {scope === "cidade" && (
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Cidade</span>
          <input name="city" required minLength={2} maxLength={120} className="input w-full" disabled={disabled || pending} />
        </label>
      )}
      <label className="text-sm sm:col-span-2"><span className="mb-1 block text-xs text-muted">OBS · orientações para esta pesquisa</span><textarea name="observations" rows={3} maxLength={3000} disabled={disabled || pending} className="input w-full" placeholder="Ex.: conferir o link da bio do Instagram; diferenciar site próprio de página em domínio de terceiros; registrar a fonte." /><span className="text-xs text-muted">O Hermes recebe estas instruções junto com o nicho e a localização.</span></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn-primary" disabled={disabled || pending}>{pending ? "Enviando…" : "🔎 Iniciar pesquisa"}</button>
        <span className="text-xs text-muted">A quantidade é uma meta: se as fontes ou os limites acabarem antes, o Hermes entrega o que achou e explica a diferença.</span>
      </div>
      {state.error && <p role="alert" className="text-xs text-rose-300 sm:col-span-2">{state.error}</p>}
      {state.ok && <p className="text-xs text-emerald-300 sm:col-span-2">{state.ok}</p>}
    </form>
  );
}

export function CancelSearchButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<PedidoState, FormData>(cancelSearch, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button className="btn-ghost text-xs" disabled={pending}>{pending ? "…" : "Cancelar pedido"}</button>
      {state.error && <span role="alert" className="text-xs text-rose-300">{state.error}</span>}
    </form>
  );
}

/** Para a pesquisa que o Hermes está fazendo agora. O que já foi cadastrado fica. */
export function InterruptSearchButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<PedidoState, FormData>(interruptSearch, {});
  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Interromper a pesquisa do Hermes agora? Os leads já cadastrados são mantidos.")) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <button className="btn-danger text-xs" disabled={pending}>{pending ? "…" : "⛔ Interromper pesquisa"}</button>
      {state.error && <span role="alert" className="text-xs text-rose-300">{state.error}</span>}
      {state.ok && <span className="text-xs text-emerald-300">{state.ok}</span>}
    </form>
  );
}
