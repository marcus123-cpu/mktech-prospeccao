-- A lista de tokens passa a respeitar a RLS de quem consulta (sem SECURITY
-- DEFINER). O navegador recebe permissão só nas colunas sem o hash.
alter view public.integration_tokens_public set (security_invoker = true);
grant select (id, name, token_prefix, scopes, created_at, revoked_at, last_used_at)
  on public.integration_tokens to authenticated;
create policy admin_le on public.integration_tokens for select to authenticated using (public.is_admin());
