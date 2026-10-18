import { ErrorBox, PageHeader } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { fmtDateTime } from "@/lib/time";
import { NewTokenForm, RevokeButton } from "./Forms";

export const metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const { supabase } = await requireAdmin();
  const tokens = await supabase.from("integration_tokens_public").select("*").order("created_at", { ascending: false });

  return (
    <>
      <PageHeader title="⚙️ Configurações" />
      <nav className="mb-5 flex flex-wrap gap-2"><a className="btn-ghost" href="/conexao">Conexão</a><a className="btn-ghost" href="/aprendizado">Aprendizado</a><a className="btn-ghost" href="/execucoes">Configurações de pesquisa</a><a className="btn-ghost" href="/disparo?aba=config">Configurações de envio</a></nav>
      <div className="space-y-6">


        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-semibold">Credenciais da integração</summary>
          <p className="mb-4 text-xs text-muted">
            O token do Hermes só consulta duplicados, cadastra candidatos, registra execuções e lê estas configurações. Ele
            não altera etapas, contatos ou valores e não apaga leads.
          </p>
          <NewTokenForm />
          {tokens.error ? (
            <div className="mt-4"><ErrorBox message={dbErrorMessage(tokens.error)} /></div>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {(tokens.data ?? []).map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <div className="font-medium">
                      {t.name} <code className="text-xs text-muted">{t.token_prefix}…</code>
                    </div>
                    <div className="text-xs text-muted">
                      Criado em {fmtDateTime(t.created_at)} · último uso {fmtDateTime(t.last_used_at)}
                      {t.revoked_at && <span className="text-rose-300"> · revogado em {fmtDateTime(t.revoked_at)}</span>}
                    </div>
                  </div>
                  {!t.revoked_at && <RevokeButton id={t.id} />}
                </li>
              ))}
              {tokens.data?.length === 0 && <li className="py-3 text-sm text-muted">Nenhum token criado.</li>}
            </ul>
          )}
        </details>
      </div>
    </>
  );
}
