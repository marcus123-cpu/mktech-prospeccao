-- Aprendizados do Hermes: lições gerais tiradas das conversas. Ele propõe; só entram no prompt as que você aprova.
create table public.hermes_learnings (
  id uuid primary key default gen_random_uuid(),
  lesson text not null check (char_length(lesson) between 15 and 300),
  status text not null default 'pendente' check (status in ('pendente','ativa','recusada')),
  source text not null default 'hermes' check (source in ('hermes','manual')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index hermes_learnings_lesson_idx on public.hermes_learnings (lower(lesson));
alter table public.hermes_learnings enable row level security;
revoke all on public.hermes_learnings from anon, authenticated;

create function public.admin_learnings_list() returns setof public.hermes_learnings
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return query select * from hermes_learnings order by (status = 'pendente') desc, created_at desc limit 200;
end $$;

create function public.admin_learning_set(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if p_status not in ('pendente','ativa','recusada') then raise exception 'Status inválido.' using errcode = '22023'; end if;
  if p_status = 'ativa' and (select count(*) from hermes_learnings where status = 'ativa' and id <> p_id) >= 20 then
    raise exception 'No máximo 20 aprendizados ativos. Recuse algum antigo antes.' using errcode = '22023';
  end if;
  update hermes_learnings set status = p_status, decided_at = now() where id = p_id;
end $$;

create function public.admin_learning_add(p_text text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; t text := btrim(coalesce(p_text, ''));
begin
  perform require_admin();
  if char_length(t) not between 15 and 300 then raise exception 'Escreva de 15 a 300 caracteres.' using errcode = '22023'; end if;
  if (select count(*) from hermes_learnings where status = 'ativa') >= 20 then
    raise exception 'No máximo 20 aprendizados ativos. Recuse algum antigo antes.' using errcode = '22023';
  end if;
  insert into hermes_learnings(lesson, status, source, decided_at) values (t, 'ativa', 'manual', now())
    on conflict (lower(lesson)) do update set status = 'ativa', decided_at = now() returning id into v;
  return v;
end $$;

-- Usadas pelo servidor da API (token já autenticado na rota).
create function public.api_learnings_active() returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(lesson order by created_at), '{}') from (select lesson, created_at from hermes_learnings where status = 'ativa' order by created_at limit 20) x
$$;
create function public.api_learning_propose(p_lesson text) returns boolean language plpgsql security definer set search_path = public as $$
declare t text := btrim(coalesce(p_lesson, ''));
begin
  if char_length(t) not between 15 and 300 then return false; end if;
  if (select count(*) from hermes_learnings where status = 'pendente') >= 40 then return false; end if;
  insert into hermes_learnings(lesson) values (t) on conflict (lower(lesson)) do nothing;
  return found;
end $$;

revoke execute on function public.admin_learnings_list() from public, anon, service_role;
revoke execute on function public.admin_learning_set(uuid, text) from public, anon, service_role;
revoke execute on function public.admin_learning_add(text) from public, anon, service_role;
revoke execute on function public.api_learnings_active() from public, anon, authenticated;
revoke execute on function public.api_learning_propose(text) from public, anon, authenticated;
grant execute on function public.admin_learnings_list() to authenticated;
grant execute on function public.admin_learning_set(uuid, text) to authenticated;
grant execute on function public.admin_learning_add(text) to authenticated;
grant execute on function public.api_learnings_active() to service_role;
grant execute on function public.api_learning_propose(text) to service_role;
