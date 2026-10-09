import { ErrorBox, PageHeader } from "@/components/ui";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";
import { fmtDateTime } from "@/lib/time";
import { NewTokenForm, RevokeButton, SettingsForm } from "./Forms";

export const metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const { supabase } = await requireAdmin();
  const [settings, tokens] = await Promise.all([
    supabase.from("prospecting_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("integration_tokens_public").select("*").order("created_at", { ascending: false }),
  ]);

  return (
    <>
      <PageHeader title="Configurações" />
      <div className="space-y-6">
        <section className="card p-4">
          <h2 className="mb-1 text-sm font-semibold">Prospecção do Hermes</h2>
          <p className="mb-4 text-xs text-muted">
            O Hermes lê estes valores no início de cada execução. A meta é um teto: se houver menos candidatos adequados, ele
            cadastra só esses.
          </p>
          {settings.error || !settings.data ? (
            <ErrorBox message={dbErrorMessage(settings.error) || "Configurações não encontradas."} />
          ) : (
            <SettingsForm s={settings.data} />
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-1 text-sm font-semibold">Credenciais da integração</h2>
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
        </section>
      </div>
    </>
  );
}
