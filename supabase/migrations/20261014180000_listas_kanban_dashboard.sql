-- Listas de prospecção, funil Kanban (11 etapas), campanhas a partir de listas e dashboard.
-- Nenhuma função aqui envia mensagem: disparo só existe em campanha ativada pelo administrador.

-- ===== Listas =====
create table public.lead_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index lead_lists_name_uq on public.lead_lists (lower(btrim(name)));
create table public.lead_list_items (
  list_id uuid not null references public.lead_lists(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  added_at timestamptz not null default now(), added_by uuid,
  primary key (list_id, lead_id)
);
create index lead_list_items_lead_idx on public.lead_list_items(lead_id);

-- ===== Kanban =====
create table public.lead_kanban (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  stage text not null check (stage in ('novo','na_lista','contatado','aguardando_resposta','respondeu','interessado','proposta_enviada','negociacao','fechado','perdido','nao_contatar')),
  source text not null default 'manual' check (source in ('manual','hermes')),
  reason text, updated_at timestamptz not null default now(), updated_by uuid
);
create table public.lead_kanban_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_stage text, to_stage text not null, source text not null, reason text,
  created_by uuid, created_at timestamptz not null default now()
);
create index lead_kanban_events_lead_idx on public.lead_kanban_events(lead_id, id desc);

do $$ declare t text; begin
  foreach t in array array['lead_lists','lead_list_items','lead_kanban','lead_kanban_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy admin_le on public.%I for select to authenticated using (public.is_admin())', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Posição de cada lead no funil: a conversa real (envio, resposta, etapa comercial) manda;
-- um movimento manual vale até o próximo evento real. Bloqueio de contato sempre vence.
create function public.kanban_rank(p_stage text) returns integer language sql immutable as $$
  select array_position(array['novo','na_lista','contatado','aguardando_resposta','respondeu','interessado','proposta_enviada','negociacao','fechado','perdido','nao_contatar'], p_stage)
$$;
create view public.prospect_kanban with (security_invoker = true) as
with base as (
  select l.id, l.business_name, l.city, l.state, l.niche, l.fit_score, l.contacted, l.do_not_contact, l.updated_at as lead_updated_at,
    l.stage as lead_stage, cl.stage as cstage, cl.updated_at as cl_updated_at,
    (select max(r.received_at) from outreach_replies r where r.lead_id = l.id and r.kind = 'humana' and not r.simulated) as last_reply_at,
    (select max(b.sent_at) from commercial_outbox b where b.lead_id = l.id and b.status in ('enviada','entregue') and not b.simulated) as last_sent_at,
    (select max(m.greeting_sent_at) from outreach_messages m where m.lead_id = l.id) as legacy_sent_at,
    (select count(*) from lead_list_items i where i.lead_id = l.id)::int as lists
  from leads l left join commercial_leads cl on cl.lead_id = l.id
), derived as (
  select b.*, case
    when b.do_not_contact or b.cstage = 'NAO_CONTATAR' then 'nao_contatar'
    when b.lead_stage = 'fechado' then 'fechado'
    when b.lead_stage in ('sem_interesse','desqualificado') or b.cstage = 'PERDIDO' then 'perdido'
    when b.cstage = 'NEGOCIACAO' then 'negociacao'
    when b.lead_stage = 'proposta_enviada' then 'proposta_enviada'
    when b.lead_stage = 'interessado' or b.cstage = 'INTERESSE_IDENTIFICADO' then 'interessado'
    when b.last_reply_at is not null or b.lead_stage = 'respondeu' then 'respondeu'
    when b.last_sent_at is not null or b.legacy_sent_at is not null then 'aguardando_resposta'
    when b.contacted or b.lead_stage = 'contatado' then 'contatado'
    when b.lists > 0 then 'na_lista'
    else 'novo' end as derived_stage,
    greatest(b.lead_updated_at, b.cl_updated_at, b.last_reply_at, b.last_sent_at, b.legacy_sent_at) as last_event_at
  from base b
)
select d.id as lead_id, d.business_name, d.city, d.state, d.niche, d.fit_score, d.lists, d.last_reply_at, d.derived_stage,
  k.stage as override_stage,
  case when d.derived_stage = 'nao_contatar' then 'nao_contatar'
       when k.stage is not null and k.updated_at >= d.last_event_at then k.stage
       else d.derived_stage end as stage,
  case when d.derived_stage = 'nao_contatar' then d.last_event_at
       when k.stage is not null and k.updated_at >= d.last_event_at then k.updated_at
       else d.last_event_at end as moved_at
from derived d left join lead_kanban k on k.lead_id = d.id;
revoke all on public.prospect_kanban from anon, authenticated;
grant select on public.prospect_kanban to authenticated;
grant select on public.prospect_kanban to service_role;

create function public.admin_kanban_move(p_lead uuid, p_stage text, p_note text default null, p_value numeric default null, p_closed_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare cur text; l leads; note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio', 0));
  select * into l from leads where id = p_lead for update;
  if l.id is null then raise exception 'Lead não encontrado.' using errcode = '22023'; end if;
  if p_stage is null or public.kanban_rank(p_stage) is null then raise exception 'Etapa inválida.' using errcode = '22023'; end if;
  select stage into cur from prospect_kanban where lead_id = p_lead;
  if cur = p_stage then return; end if;
  if cur = 'nao_contatar' then
    raise exception 'Lead marcado como não contatar: o bloqueio só é removido na ficha do lead.' using errcode = '22023';
  end if;
  if p_stage = 'novo' and (l.contacted or cur not in ('novo','na_lista')) then
    raise exception 'Lead já foi contatado e não volta para Novo.' using errcode = '22023';
  end if;
  if p_stage = 'na_lista' and not exists (select 1 from lead_list_items where lead_id = p_lead) then
    raise exception 'Adicione o lead a uma lista primeiro.' using errcode = '22023';
  end if;
  if p_stage = 'fechado' then
    -- Venda só fecha com confirmação concreta: valor e data informados pelo administrador.
    if p_value is null or p_closed_at is null then raise exception 'Informe valor e data do fechamento confirmados.' using errcode = '22023'; end if;
    perform admin_register_closing(p_lead, p_value, p_closed_at, note);
  elsif p_stage = 'perdido' then
    if note is null then raise exception 'Informe o motivo da perda.' using errcode = '22023'; end if;
    perform admin_change_stage(p_lead, 'sem_interesse', note, note);
  elsif p_stage = 'nao_contatar' then
    update leads set do_not_contact = true, do_not_contact_at = now() where id = p_lead;
  elsif p_stage in ('contatado','respondeu','interessado','proposta_enviada') then
    perform admin_change_stage(p_lead, p_stage::lead_stage, note, null);
  end if;
  insert into lead_kanban(lead_id, stage, source, reason, updated_by) values (p_lead, p_stage, 'manual', note, auth.uid())
  on conflict (lead_id) do update set stage = excluded.stage, source = 'manual', reason = excluded.reason, updated_at = now(), updated_by = excluded.updated_by;
  insert into lead_kanban_events(lead_id, from_stage, to_stage, source, reason, created_by) values (p_lead, cur, p_stage, 'manual', note, auth.uid());
end $$;
revoke execute on function public.admin_kanban_move(uuid, text, text, numeric, timestamptz) from public, anon, service_role;
grant execute on function public.admin_kanban_move(uuid, text, text, numeric, timestamptz) to authenticated;

-- ===== Filtros e listas =====
create function public.lead_filter_ids(f jsonb) returns setof uuid language sql stable security definer set search_path = public as $$
  select l.id from leads l
  where (nullif(f ->> 'q', '') is null or l.business_name ilike '%' || (f ->> 'q') || '%' or l.city ilike '%' || (f ->> 'q') || '%')
    and (nullif(f ->> 'niche', '') is null or l.niche ilike '%' || (f ->> 'niche') || '%')
    and (nullif(f ->> 'city', '') is null or l.city ilike '%' || (f ->> 'city') || '%')
    and (nullif(f ->> 'state', '') is null or l.state = upper(f ->> 'state'))
    and (nullif(f ->> 'min_score', '') is null or coalesce(l.fit_score, 0) >= (f ->> 'min_score')::int)
    and (nullif(f ->> 'max_score', '') is null or coalesce(l.fit_score, 0) <= (f ->> 'max_score')::int)
    and (nullif(f ->> 'in_list', '') is null or exists (select 1 from lead_list_items i where i.lead_id = l.id and i.list_id = (f ->> 'in_list')::uuid))
    and (nullif(f ->> 'not_in_list', '') is null or not exists (select 1 from lead_list_items i where i.lead_id = l.id and i.list_id = (f ->> 'not_in_list')::uuid))
$$;
revoke execute on function public.lead_filter_ids(jsonb) from public, anon, authenticated, service_role;

create function public.admin_filter_count(f jsonb) returns integer language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  return (select count(*)::int from public.lead_filter_ids(f));
end $$;

create function public.admin_list_create(p_name text) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_admin();
  if nullif(btrim(coalesce(p_name, '')), '') is null or length(btrim(p_name)) > 80 then raise exception 'Informe um nome de até 80 caracteres.' using errcode = '22023'; end if;
  begin
    insert into lead_lists(name, created_by) values (btrim(p_name), auth.uid()) returning id into v_id;
  exception when unique_violation then raise exception 'Já existe uma lista com esse nome.' using errcode = '23505';
  end;
  return v_id;
end $$;

create function public.admin_list_rename(p_list uuid, p_name text) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if nullif(btrim(coalesce(p_name, '')), '') is null or length(btrim(p_name)) > 80 then raise exception 'Informe um nome de até 80 caracteres.' using errcode = '22023'; end if;
  begin
    update lead_lists set name = btrim(p_name), updated_at = now() where id = p_list;
  exception when unique_violation then raise exception 'Já existe uma lista com esse nome.' using errcode = '23505';
  end;
  if not found then raise exception 'Lista não encontrada.' using errcode = '22023'; end if;
end $$;

create function public.admin_list_delete(p_list uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  delete from lead_lists where id = p_list;
end $$;

create function public.admin_list_add(p_list uuid, p_leads uuid[]) returns jsonb language plpgsql security definer set search_path = public as $$
declare added integer; total integer;
begin
  perform require_admin();
  if not exists (select 1 from lead_lists where id = p_list) then raise exception 'Lista não encontrada.' using errcode = '22023'; end if;
  select count(*) into total from (select distinct x from unnest(coalesce(p_leads, '{}')) x) s where exists (select 1 from leads where id = s.x);
  insert into lead_list_items(list_id, lead_id, added_by)
  select p_list, x, auth.uid() from (select distinct x from unnest(coalesce(p_leads, '{}')) x) s where exists (select 1 from leads where id = s.x)
  on conflict do nothing;
  get diagnostics added = row_count;
  return jsonb_build_object('added', added, 'duplicates', total - added);
end $$;

-- "Selecionar todos os resultados filtrados": adiciona pelo filtro, sem depender da página aberta.
create function public.admin_list_add_filtered(p_list uuid, f jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare added integer; total integer;
begin
  perform require_admin();
  if not exists (select 1 from lead_lists where id = p_list) then raise exception 'Lista não encontrada.' using errcode = '22023'; end if;
  select count(*) into total from public.lead_filter_ids(f);
  insert into lead_list_items(list_id, lead_id, added_by) select p_list, id, auth.uid() from public.lead_filter_ids(f) id on conflict do nothing;
  get diagnostics added = row_count;
  return jsonb_build_object('added', added, 'duplicates', total - added);
end $$;

create function public.admin_list_remove(p_list uuid, p_leads uuid[]) returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform require_admin();
  delete from lead_list_items where list_id = p_list and lead_id = any(coalesce(p_leads, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;

create function public.admin_list_move(p_from uuid, p_to uuid, p_leads uuid[]) returns jsonb language plpgsql security definer set search_path = public as $$
declare moved integer;
begin
  perform require_admin();
  if p_from = p_to then raise exception 'Escolha outra lista de destino.' using errcode = '22023'; end if;
  if not exists (select 1 from lead_lists where id = p_to) then raise exception 'Lista de destino não encontrada.' using errcode = '22023'; end if;
  insert into lead_list_items(list_id, lead_id, added_by)
  select p_to, lead_id, auth.uid() from lead_list_items where list_id = p_from and lead_id = any(coalesce(p_leads, '{}')) on conflict do nothing;
  get diagnostics moved = row_count;
  delete from lead_list_items where list_id = p_from and lead_id = any(coalesce(p_leads, '{}'));
  return jsonb_build_object('moved', moved);
end $$;

revoke execute on function public.admin_filter_count(jsonb), public.admin_list_create(text), public.admin_list_rename(uuid, text), public.admin_list_delete(uuid),
  public.admin_list_add(uuid, uuid[]), public.admin_list_add_filtered(uuid, jsonb), public.admin_list_remove(uuid, uuid[]), public.admin_list_move(uuid, uuid, uuid[])
  from public, anon, service_role;
grant execute on function public.admin_filter_count(jsonb), public.admin_list_create(text), public.admin_list_rename(uuid, text), public.admin_list_delete(uuid),
  public.admin_list_add(uuid, uuid[]), public.admin_list_add_filtered(uuid, jsonb), public.admin_list_remove(uuid, uuid[]), public.admin_list_move(uuid, uuid, uuid[])
  to authenticated;

-- ===== Campanhas: a partir de lista, todos os elegíveis e estatísticas =====
alter table public.commercial_campaigns add column source_list_id uuid references public.lead_lists(id) on delete set null;

create function public.admin_campaign_add_list(p_campaign uuid, p_list uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare ids uuid[]; r jsonb;
begin
  perform require_admin();
  select coalesce(array_agg(lead_id), '{}') into ids from lead_list_items where list_id = p_list;
  r := public.admin_campaign_add_leads(p_campaign, ids);
  update commercial_campaigns set source_list_id = p_list, updated_at = now() where id = p_campaign;
  return r;
end $$;

create function public.admin_campaign_add_eligible(p_campaign uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare ids uuid[]; r jsonb;
begin
  perform require_admin();
  select coalesce(array_agg(l.id), '{}') into ids from leads l
  where l.stage = 'novo' and not l.contacted and not l.do_not_contact and l.phone_e164 is not null
    and not exists (select 1 from commercial_campaign_leads m where m.lead_id = l.id);
  r := public.admin_campaign_add_leads(p_campaign, ids);
  return r;
end $$;

-- Resumo da campanha: destinatários, envios reais, entregas, respostas, falhas e bloqueios.
create function public.admin_campaign_stats(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ids uuid[];
begin
  perform require_admin();
  select coalesce(array_agg(lead_id), '{}') into ids from commercial_campaign_leads where campaign_id = p_campaign;
  return jsonb_build_object(
    'recipients', cardinality(ids),
    'prepared', (select count(*) from commercial_outbox where lead_id = any(ids) and status in ('criada','enfileirada') and not simulated),
    'sending', (select count(*) from commercial_outbox where lead_id = any(ids) and status = 'enviando'),
    'sent', (select count(*) from commercial_outbox where lead_id = any(ids) and status in ('enviada','entregue') and not simulated),
    'delivered', (select count(*) from commercial_outbox where lead_id = any(ids) and status = 'entregue'),
    'simulated', (select count(*) from commercial_outbox where lead_id = any(ids) and simulated),
    'replies', (select count(*) from outreach_replies where lead_id = any(ids) and kind = 'humana' and not simulated),
    'failures', (select count(*) from commercial_outbox where lead_id = any(ids) and status in ('falhou','desconhecido')),
    'cancelled', (select count(*) from commercial_outbox where lead_id = any(ids) and status = 'cancelada'),
    'blocked', (select count(*) from leads where id = any(ids) and do_not_contact),
    'contacted', (select count(*) from leads where id = any(ids) and contacted));
end $$;

revoke execute on function public.admin_campaign_add_list(uuid, uuid), public.admin_campaign_add_eligible(uuid), public.admin_campaign_stats(uuid) from public, anon, service_role;
grant execute on function public.admin_campaign_add_list(uuid, uuid), public.admin_campaign_add_eligible(uuid), public.admin_campaign_stats(uuid) to authenticated;

-- Resposta de seleção em massa mais curta: a lista de recusas é limitada, o total vai à parte.
create or replace function public.admin_campaign_add_leads(p_campaign uuid, p_leads uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare camp commercial_campaigns; lid uuid; l leads; cl commercial_leads; added integer:=0; rejected jsonb:='[]'; rejected_total integer:=0; why text; base jsonb; mem jsonb; prev_reason text;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into camp from commercial_campaigns where id=p_campaign for update;
  if camp.id is null then raise exception 'Campanha não encontrada.' using errcode='22023'; end if;
  if camp.status='encerrada' then raise exception 'Campanha encerrada não recebe leads.' using errcode='22023'; end if;
  for lid in select distinct x from unnest(coalesce(p_leads,'{}')) x loop
    why:=null;
    select * into l from leads where id=lid;
    select * into cl from commercial_leads where lead_id=lid for update;
    if l.id is null then why:='Lead não encontrado.';
    elsif l.do_not_contact then why:='Lead pediu para não ser contatado.';
    elsif l.phone_e164 is null then why:='Sem telefone válido.';
    elsif l.contacted or l.stage<>'novo' then why:='Lead já foi contatado ou saiu da etapa inicial.';
    elsif exists(select 1 from commercial_campaign_leads m where m.lead_id=lid) then why:='Lead já pertence a uma campanha.';
    elsif exists(select 1 from commercial_campaign_leads m join leads o on o.id=m.lead_id where o.id<>lid and o.phone_e164=any(outreach_phone_variants(l.phone_e164)))
      or exists(select 1 from leads o where o.id<>lid and o.contacted and o.phone_e164=any(outreach_phone_variants(l.phone_e164))) then why:='Telefone duplicado em outro lead já selecionado ou contatado.';
    end if;
    if why is null and not cl.eligible then
      prev_reason:=cl.eligibility_reason;
      if prev_reason='Retirado da fila pelo administrador' then update commercial_leads set eligibility_reason=null where lead_id=lid; end if;
      if not public.commercial_v6_enqueue_verified(lid) then
        if prev_reason='Retirado da fila pelo administrador' then update commercial_leads set eligibility_reason=prev_reason where lead_id=lid; end if;
        why:='Pesquisa insuficiente (telefone, WhatsApp público, fontes ou diagnóstico).';
      end if;
    end if;
    if why is null then
      select to_jsonb(c) into base from commercial_leads c where lead_id=lid;
      select to_jsonb(m) into mem from lead_conversation_memory m where lead_id=lid;
      insert into commercial_campaign_leads(lead_id,campaign_id,baseline,baseline_memory) values (lid,p_campaign,base,mem);
      added:=added+1;
      perform commercial_campaign_log_event(p_campaign,lid,'lead_adicionado','{}');
    else
      rejected_total:=rejected_total+1;
      if jsonb_array_length(rejected)<50 then rejected:=rejected||jsonb_build_array(jsonb_build_object('lead_id',lid,'reason',why)); end if;
    end if;
  end loop;
  return jsonb_build_object('added',added,'rejected',rejected,'rejected_total',rejected_total);
end $$;

-- ===== Dashboard =====
create function public.admin_prospecting_dashboard() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare kanban jsonb;
begin
  perform require_admin();
  select coalesce(jsonb_object_agg(stage, n), '{}') into kanban from (select stage, count(*) n from prospect_kanban group by stage) s;
  return jsonb_build_object(
    'researched', (select coalesce(sum(searched), 0) from hermes_runs),
    'new_leads', (select coalesce(sum(created), 0) from hermes_runs),
    'existing_leads', (select coalesce(sum(existing), 0) from hermes_runs),
    'with_contact', (select count(*) from leads where contacted),
    'in_lists', (select count(distinct lead_id) from lead_list_items),
    'active_campaigns', (select count(*) from commercial_campaigns where status = 'ativa'),
    'prepared', (select count(*) from commercial_outbox where status in ('criada','enfileirada') and not simulated)
              + (select count(*) from outreach_messages where status = 'pronta'),
    'sent', (select count(*) from commercial_outbox where status in ('enviada','entregue') and not simulated)
          + (select count(*) from outreach_messages where greeting_sent_at is not null),
    'delivered', (select count(*) from commercial_outbox where status = 'entregue'),
    'replies', (select count(*) from outreach_replies where kind = 'humana' and not simulated),
    'kanban', kanban,
    'interested', coalesce((kanban ->> 'interessado')::int, 0),
    'proposals', coalesce((kanban ->> 'proposta_enviada')::int, 0),
    'negotiations', coalesce((kanban ->> 'negociacao')::int, 0),
    'closed', coalesce((kanban ->> 'fechado')::int, 0));
end $$;
revoke execute on function public.admin_prospecting_dashboard() from public, anon, service_role;
grant execute on function public.admin_prospecting_dashboard() to authenticated;
