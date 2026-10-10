-- RLS e permissões.
-- * Navegador (anon/authenticated): só leitura, e só para administradores.
--   Toda escrita passa pelas funções admin_* (que verificam is_admin()).
-- * Servidor (service_role): executa as funções api_* do Hermes.
-- * Tabelas de tokens e idempotência não são legíveis pelo navegador.

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_admins', 'leads', 'lead_evidences', 'contact_events', 'stage_events', 'lead_notes', 'proposals',
    'hermes_runs', 'duplicate_reviews', 'dedupe_events', 'integration_tokens', 'idempotency_keys', 'prospecting_settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;

  foreach t in array array[
    'leads', 'lead_evidences', 'contact_events', 'stage_events', 'lead_notes', 'proposals',
    'hermes_runs', 'duplicate_reviews', 'dedupe_events', 'prospecting_settings'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy admin_le on public.%I for select to authenticated using (public.is_admin())', t);
  end loop;
end $$;

grant select on public.app_admins to authenticated;
create policy proprio_admin on public.app_admins for select to authenticated using (user_id = auth.uid());

-- Lista de tokens sem o hash, para a tela de Configurações.
create view public.integration_tokens_public
with (security_invoker = false) as
  select id, name, token_prefix, scopes, created_at, revoked_at, last_used_at
  from public.integration_tokens
  where public.is_admin();
revoke all on public.integration_tokens_public from anon, authenticated;
grant select on public.integration_tokens_public to authenticated;

grant all on all tables in schema public to service_role;

-- Funções: ninguém executa por padrão.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_admin(),
  public.admin_create_lead(jsonb, boolean),
  public.admin_update_lead(uuid, jsonb),
  public.admin_mark_contacted(uuid, timestamptz, text, text),
  public.admin_correct_contact(uuid, text, timestamptz),
  public.admin_change_stage(uuid, lead_stage, text, text),
  public.admin_add_note(uuid, text),
  public.admin_schedule_follow_up(uuid, timestamptz),
  public.admin_register_proposal(uuid, numeric, timestamptz, text),
  public.admin_register_closing(uuid, numeric, timestamptz, text),
  public.admin_bulk_update(uuid[], text, text),
  public.admin_resolve_review(uuid, text, uuid, jsonb, text),
  public.admin_import_rows(jsonb, boolean),
  public.admin_create_integration_token(text),
  public.admin_revoke_integration_token(uuid),
  public.admin_update_settings(jsonb),
  public.dashboard_metrics(date, date)
to authenticated;

-- Funções auxiliares chamadas pelas políticas e pelas funções acima
-- (security definer) continuam acessíveis ao dono; is_admin precisa ser
-- executável por authenticated porque aparece nas políticas.

grant execute on function
  public.api_token_check(text, text),
  public.api_existing_identifiers(uuid),
  public.api_check_duplicates(uuid, jsonb),
  public.api_register_candidate(uuid, text, jsonb, uuid),
  public.api_start_run(uuid, text, jsonb),
  public.api_finish_run(uuid, uuid, jsonb),
  public.api_get_settings(uuid)
to service_role;

-- Novas funções criadas depois também nascem fechadas.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
