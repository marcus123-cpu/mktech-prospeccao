-- Aprendizado do Hermes: durante 30 dias ele observa como você trabalha no WhatsApp,
-- anota o que aprendeu a cada dia e mantém um aprendizado.md. Só leitura das conversas: nunca envia nada.
create table public.hermes_apprenticeship (
  id integer primary key default 1 check (id = 1),
  status text not null default 'nao_iniciado' check (status in ('nao_iniciado','aprendendo','concluido','teste','aprovado')),
  started_on date,
  study_requested_at timestamptz,
  playbook text not null default '',
  playbook_updated_at timestamptz,
  final_report text,
  final_report_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.hermes_apprenticeship(id) values (1);
create table public.hermes_apprenticeship_days (
  day date primary key,
  notes text not null,
  stats jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hermes_apprenticeship enable row level security;
alter table public.hermes_apprenticeship_days enable row level security;
revoke all on public.hermes_apprenticeship, public.hermes_apprenticeship_days from anon, authenticated;

create function public.apprenticeship_today() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- Números do dia calculados pelo banco (não pelo modelo).
create function public.apprenticeship_day_stats(p_day date) returns jsonb language sql stable security definer set search_path = public as $$
  with e as (
    select * from conversation_timeline
    where (occurred_at at time zone 'America/Sao_Paulo')::date = p_day
  )
  select jsonb_build_object(
    'leads', (select count(distinct lead_id) from e),
    'suas_mensagens_texto', (select count(*) from e where source = 'manual' and media = 'texto'),
    'seus_audios', (select count(*) from e where source = 'manual' and media = 'audio'),
    'suas_outras_midias', (select count(*) from e where source = 'manual' and media not in ('texto','audio')),
    'respostas_de_pessoas', (select count(*) from e where source = 'humana'),
    'respostas_automaticas', (select count(*) from e where source = 'automatica'),
    'saudacoes_enviadas', (select count(*) from e where source = 'saudacao'))
$$;
revoke execute on function public.apprenticeship_day_stats(date) from public, anon, authenticated, service_role;

create function public.admin_apprenticeship_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.hermes_apprenticeship; n integer;
begin
  perform require_admin();
  select * into p from hermes_apprenticeship where id = 1;
  n := case when p.started_on is null then 0 else (public.apprenticeship_today() - p.started_on) + 1 end;
  return jsonb_build_object('program', to_jsonb(p), 'day_number', n, 'total_days', 30,
    'days', coalesce((select jsonb_agg(to_jsonb(d) order by d.day desc) from hermes_apprenticeship_days d), '[]'));
end $$;

create function public.admin_apprenticeship_start() returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if (select status from hermes_apprenticeship where id = 1) <> 'nao_iniciado' then
    raise exception 'O aprendizado já foi iniciado.' using errcode = '22023';
  end if;
  update hermes_apprenticeship set status = 'aprendendo', started_on = public.apprenticeship_today(), updated_at = now() where id = 1;
end $$;

create function public.admin_apprenticeship_request_study() returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update hermes_apprenticeship set study_requested_at = now() where id = 1 and status = 'aprendendo';
end $$;

create function public.admin_apprenticeship_set_status(p_status text) returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  perform require_admin();
  select status into cur from hermes_apprenticeship where id = 1;
  if not ((cur = 'concluido' and p_status = 'teste') or (cur = 'teste' and p_status in ('aprovado','concluido')) or (cur = 'aprovado' and p_status = 'teste')) then
    raise exception 'Mudança de etapa não permitida (% para %).', cur, p_status using errcode = '22023';
  end if;
  update hermes_apprenticeship set status = p_status, updated_at = now() where id = 1;
end $$;

-- Usadas pelo estudante (PC), com token já autenticado na rota.
create function public.api_apprenticeship_state() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', p.status, 'started_on', p.started_on, 'today', public.apprenticeship_today(),
    'study_requested', p.study_requested_at is not null, 'playbook', p.playbook, 'has_final', p.final_report is not null,
    'saved_days', coalesce((select jsonb_agg(day order by day) from hermes_apprenticeship_days), '[]'))
  from hermes_apprenticeship p where p.id = 1
$$;

create function public.api_apprenticeship_day_data(p_day date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  select coalesce(jsonb_agg(c order by c ->> 'last_at' desc), '[]') into out from (
    select jsonb_build_object('lead', l.business_name, 'niche', l.niche, 'city', l.city, 'stage', l.stage,
      'last_at', max(t.occurred_at),
      'events', (select jsonb_agg(jsonb_build_object('at', to_char(x.occurred_at at time zone 'America/Sao_Paulo', 'HH24:MI'),
          'who', case when x.direction = 'entrada' then (case when x.source = 'automatica' then 'resposta automática' else 'cliente' end)
                      when x.source = 'manual' then 'VOCÊ' else 'sistema (saudação)' end,
          'media', x.media, 'text', left(x.body, 700)) order by x.occurred_at)
        from (select * from conversation_timeline y where y.lead_id = l.id and (y.occurred_at at time zone 'America/Sao_Paulo')::date = p_day order by y.occurred_at limit 30) x)) as c
    from conversation_timeline t join leads l on l.id = t.lead_id
    where (t.occurred_at at time zone 'America/Sao_Paulo')::date = p_day
    group by l.id order by max(t.occurred_at) desc limit 40
  ) s;
  return jsonb_build_object('day', p_day, 'stats', public.apprenticeship_day_stats(p_day), 'conversations', out);
end $$;

create function public.api_apprenticeship_save_day(p_day date, p_notes text) returns void language plpgsql security definer set search_path = public as $$
declare p public.hermes_apprenticeship;
begin
  select * into p from hermes_apprenticeship where id = 1 for update;
  if p.status = 'nao_iniciado' then raise exception 'Aprendizado não iniciado.' using errcode = '22023'; end if;
  insert into hermes_apprenticeship_days(day, notes, stats) values (p_day, left(p_notes, 20000), public.apprenticeship_day_stats(p_day))
    on conflict (day) do update set notes = excluded.notes, stats = excluded.stats, updated_at = now();
  update hermes_apprenticeship set study_requested_at = null,
    status = case when status = 'aprendendo' and p_day >= started_on + 29 then 'concluido' else status end, updated_at = now() where id = 1;
end $$;

create function public.api_apprenticeship_save_playbook(p_text text) returns void language sql security definer set search_path = public as $$
  update hermes_apprenticeship set playbook = left(p_text, 40000), playbook_updated_at = now(), updated_at = now() where id = 1
$$;
create function public.api_apprenticeship_save_final(p_text text) returns void language sql security definer set search_path = public as $$
  update hermes_apprenticeship set final_report = left(p_text, 40000), final_report_at = now(), updated_at = now() where id = 1
$$;

revoke execute on function public.admin_apprenticeship_get() from public, anon, service_role;
revoke execute on function public.admin_apprenticeship_start() from public, anon, service_role;
revoke execute on function public.admin_apprenticeship_request_study() from public, anon, service_role;
revoke execute on function public.admin_apprenticeship_set_status(text) from public, anon, service_role;
grant execute on function public.admin_apprenticeship_get() to authenticated;
grant execute on function public.admin_apprenticeship_start() to authenticated;
grant execute on function public.admin_apprenticeship_request_study() to authenticated;
grant execute on function public.admin_apprenticeship_set_status(text) to authenticated;
revoke execute on function public.api_apprenticeship_state() from public, anon, authenticated;
revoke execute on function public.api_apprenticeship_day_data(date) from public, anon, authenticated;
revoke execute on function public.api_apprenticeship_save_day(date, text) from public, anon, authenticated;
revoke execute on function public.api_apprenticeship_save_playbook(text) from public, anon, authenticated;
revoke execute on function public.api_apprenticeship_save_final(text) from public, anon, authenticated;
grant execute on function public.api_apprenticeship_state() to service_role;
grant execute on function public.api_apprenticeship_day_data(date) to service_role;
grant execute on function public.api_apprenticeship_save_day(date, text) to service_role;
grant execute on function public.api_apprenticeship_save_playbook(text) to service_role;
grant execute on function public.api_apprenticeship_save_final(text) to service_role;
