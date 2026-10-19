-- "Problema no envio" no sininho: cada aviso pode ser dispensado (por usuário), sem apagar o registro do envio.
create table if not exists public.dismissed_send_issues (
  user_id uuid not null references auth.users(id) on delete cascade,
  outbox_id uuid not null references public.commercial_outbox(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, outbox_id)
);
alter table public.dismissed_send_issues enable row level security;
revoke all on public.dismissed_send_issues from public, anon, authenticated;
grant select, insert on public.dismissed_send_issues to authenticated;
grant all on public.dismissed_send_issues to service_role;
create policy dismissed_issues_select on public.dismissed_send_issues for select to authenticated using (user_id = (select auth.uid()) and (select public.is_admin()));
create policy dismissed_issues_insert on public.dismissed_send_issues for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_admin()));
