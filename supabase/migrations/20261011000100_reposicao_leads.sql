-- Reposição automática do estoque de leads.
-- Quando há menos de restock_min leads prontos para abordar, a próxima execução
-- do Hermes busca restock_batch leads de uma vez. Buscar lead não envia nada:
-- chave, fila, janela e limite diário de envio não mudam.
--
-- "Pronto para abordar": lead novo, sem contato, com WhatsApp, nota de
-- potencial 60 ou mais, com diagnóstico, que não pediu para parar e que ainda
-- não tem mensagem de envio ativa.

alter table public.prospecting_settings
  add column restock_enabled boolean not null default true,
  add column restock_min integer not null default 20 check (restock_min between 1 and 200),
  add column restock_batch integer not null default 20 check (restock_batch between 1 and 100);
alter table public.hermes_runs add column restock_target integer;

create or replace function public.prospecting_stock() returns integer
language sql stable
security invoker
set search_path = public
as $$
  select count(*)::int
  from public.leads l
  where l.stage = 'novo' and not l.contacted and not l.do_not_contact
    and l.phone_e164 is not null and l.fit_score >= 60
    and exists (select 1 from public.lead_diagnoses d where d.lead_id = l.id)
    and not exists (select 1 from public.outreach_messages m where m.lead_id = l.id and m.status <> 'cancelada')
$$;
revoke execute on function public.prospecting_stock() from public, anon, authenticated;
grant execute on function public.prospecting_stock() to authenticated, service_role;

-- Configurações para o Hermes: inclui o estoque e a meta desta passada.
create or replace function public.api_get_settings(p_token uuid) returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select to_jsonb(s) - 'id' - 'updated_at'
         || jsonb_build_object(
              'stock_ready', public.prospecting_stock(),
              'restock_needed', s.restock_enabled and public.prospecting_stock() < s.restock_min,
              'run_target', case when s.restock_enabled and public.prospecting_stock() < s.restock_min
                                 then s.restock_batch else s.daily_target end)
  from prospecting_settings s
  where s.id = 1 and p_token is not null
$$;

-- Início de execução: o servidor decide se é reposição (o agente não decide).
create or replace function public.api_start_run(p_token uuid, p_routine text, p_config jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s prospecting_settings;
  v_run uuid;
  v_open hermes_runs;
  v_stock integer := public.prospecting_stock();
  v_restock integer;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if coalesce(p_routine, '') !~ '^[a-z0-9-]{3,60}$' then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('routine inválida'));
  end if;
  select * into v_s from prospecting_settings where id = 1;
  v_restock := case when v_s.restock_enabled and v_stock < v_s.restock_min then v_s.restock_batch end;

  update hermes_runs
  set status = 'abandonada', finished_at = now(), end_reason = 'tempo limite excedido sem término registrado'
  where routine = p_routine and status = 'em_andamento'
    and started_at < now() - make_interval(mins => v_s.max_run_minutes + 15);

  begin
    insert into hermes_runs (routine, token_id, config, restock_target)
    values (p_routine, p_token, coalesce(p_config, '{}') || jsonb_build_object('stock_ready', v_stock), v_restock)
    returning id into v_run;
  exception when unique_violation then
    select * into v_open from hermes_runs where routine = p_routine and status = 'em_andamento';
    return jsonb_build_object('status', 'ja_em_andamento', 'run_id', v_open.id, 'started_at', v_open.started_at);
  end;
  return jsonb_build_object('status', 'iniciada', 'run_id', v_run, 'stock_ready', v_stock,
    'restock', v_restock is not null, 'run_target', coalesce(v_restock, v_s.daily_target));
end
$$;

create or replace function public.api_register_candidate(p_token uuid, p_key text, p jsonb, p_run uuid) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_scope text := 'token:' || p_token;
  v_hash text := md5(coalesce(p::text, '') || '|' || coalesce(p_run::text, ''));
  v_existing idempotency_keys;
  v_result jsonb;
  v_status text;
  v_settings prospecting_settings;
  v_run hermes_runs;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if p_key is null or length(p_key) not between 8 and 200 then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('Idempotency-Key obrigatória (8 a 200 caracteres)'));
  end if;
  if p_run is not null and not exists (
    select 1 from hermes_runs where id = p_run and token_id = p_token and status = 'em_andamento'
  ) then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('execução inexistente ou encerrada'));
  end if;

  -- Limites no servidor: a meta diária (horário de São Paulo) e o tempo
  -- máximo da execução valem mesmo que o agente ignore as instruções.
  select * into v_settings from prospecting_settings where id = 1;
  if p_run is not null and exists (
    select 1 from hermes_runs
    where id = p_run and started_at < now() - make_interval(mins => v_settings.max_run_minutes)
  ) then
    return jsonb_build_object('status', 'limite_atingido', 'errors', jsonb_build_array('tempo máximo da execução esgotado'));
  end if;

  insert into idempotency_keys (scope, key, request_hash)
  values (v_scope, p_key, v_hash)
  on conflict do nothing;
  if not found then
    select * into v_existing from idempotency_keys where scope = v_scope and key = p_key;
    if v_existing.request_hash <> v_hash then
      return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('Idempotency-Key já usada com outro conteúdo'));
    end if;
    return v_existing.response || jsonb_build_object('replayed', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hermes-meta-diaria', 0));
  select * into v_run from hermes_runs where id = p_run;
  if p_run is not null and v_run.restock_target is not null then
    -- Reposição do estoque: esta execução pode cadastrar até restock_target
    -- leads, e o dia tem um teto de 3 reposições para nunca sair do controle.
    if v_run.created >= v_run.restock_target then
      v_result := jsonb_build_object('status', 'limite_atingido', 'errors', jsonb_build_array('meta da reposição atingida'));
      update idempotency_keys set response = v_result where scope = v_scope and key = p_key;
      return v_result;
    end if;
    if (select count(*) from leads
        where origin = 'hermes'
          and created_at >= (now() at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo'
       ) >= greatest(v_settings.daily_target, v_settings.restock_batch * 3) then
      v_result := jsonb_build_object('status', 'limite_atingido', 'errors', jsonb_build_array('teto diário de reposição atingido'));
      update idempotency_keys set response = v_result where scope = v_scope and key = p_key;
      return v_result;
    end if;
  elsif (select count(*) from leads
      where origin = 'hermes'
        and created_at >= (now() at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo'
     ) >= v_settings.daily_target then
    v_result := jsonb_build_object('status', 'limite_atingido', 'errors', jsonb_build_array('meta diária de novos leads atingida'));
    update idempotency_keys set response = v_result where scope = v_scope and key = p_key;
    return v_result;
  end if;

  v_result := register_candidate(p, 'hermes', p_run, true, false);
  v_status := v_result ->> 'status';

  if p_run is not null then
    update hermes_runs set
      created = created + (v_status = 'criado')::int,
      existing = existing + (v_status = 'existente')::int,
      possible_duplicates = possible_duplicates + (v_status = 'possivel_duplicado')::int,
      invalid = invalid + (v_status = 'invalido')::int
    where id = p_run;
  end if;

  update idempotency_keys set response = v_result where scope = v_scope and key = p_key;
  return v_result;
end
$$;
