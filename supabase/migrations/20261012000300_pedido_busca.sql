-- Pedido de busca pelo painel: o Marcos diz quantos leads qualificados quer
-- (ex.: 30) e aperta Buscar. Um programa no PC (pedido-loop.bat) pergunta a
-- cada 2 minutos se há pedido e chama o Hermes, que abre a execução com a
-- rotina "pedido-painel": o servidor entrega o pedido mais antigo, com a meta
-- e o limite de buscas, e para de aceitar cadastros quando a meta é batida.
--   * Qualificado = cadastrado nesta execução, com WhatsApp, diagnóstico e
--     nota 60 ou mais (o mesmo critério do estoque pronto para abordar).
--   * Limite de buscas: 15 por qualificado pedido, de 150 a 500.
--   * Um pedido aberto por vez; pedido parado pode ser cancelado.
--   * Buscar lead não envia nada: chave, fila e janela do envio não mudam.

create table public.hermes_requests (
  id uuid primary key default gen_random_uuid(),
  qualified_target integer not null check (qualified_target between 1 and 100),
  max_searches integer not null check (max_searches between 10 and 500),
  max_minutes integer not null check (max_minutes between 5 and 240),
  status text not null default 'pendente' check (status in ('pendente', 'em_andamento', 'concluido', 'cancelado')),
  run_id uuid references public.hermes_runs (id) on delete set null,
  qualified_found integer,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  note text check (length(note) <= 500)
);
create unique index hermes_requests_um_aberto on public.hermes_requests ((true)) where status in ('pendente', 'em_andamento');
create index hermes_requests_created_idx on public.hermes_requests (created_at desc);
alter table public.hermes_requests enable row level security;
revoke all on public.hermes_requests from anon, authenticated;
grant select on public.hermes_requests to authenticated;
create policy admin_le on public.hermes_requests for select to authenticated using (public.is_admin());
grant all on public.hermes_requests to service_role;

alter table public.hermes_runs add column request_id uuid references public.hermes_requests (id) on delete set null;

-- Leads qualificados cadastrados numa execução.
create or replace function public.hermes_run_qualified(p_run uuid) returns integer
language sql stable
security definer
set search_path = public
as $$
  select count(*)::int from leads l
  where l.origin = 'hermes' and l.phone_e164 is not null and l.fit_score >= 60
    and exists (select 1 from lead_diagnoses d where d.lead_id = l.id)
    and exists (select 1 from lead_evidences e where e.lead_id = l.id and e.run_id = p_run)
$$;
revoke execute on function public.hermes_run_qualified(uuid) from public, anon;
grant execute on function public.hermes_run_qualified(uuid) to authenticated, service_role;

-- Fecha o pedido quando a execução dele acabou (encerrada ou abandonada).
create or replace function public.hermes_request_close(p_run uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h hermes_runs;
begin
  select * into h from hermes_runs where id = p_run;
  if h.request_id is null or h.status = 'em_andamento' then
    return;
  end if;
  update hermes_requests set status = 'concluido', finished_at = coalesce(h.finished_at, now()),
    qualified_found = public.hermes_run_qualified(p_run),
    note = left(coalesce(h.end_reason, 'execução encerrada'), 500)
  where id = h.request_id and status = 'em_andamento';
end
$$;
revoke execute on function public.hermes_request_close(uuid) from public, anon, authenticated;

-- Painel: pede N qualificados.
create or replace function public.admin_search_request(p_target integer) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s prospecting_settings;
  v_id uuid;
begin
  perform require_admin();
  if p_target is null or p_target not between 1 and 100 then
    raise exception 'quantidade deve ser de 1 a 100' using errcode = '22023';
  end if;
  select * into s from prospecting_settings where id = 1;
  begin
    insert into hermes_requests (qualified_target, max_searches, max_minutes, created_by)
    values (p_target, least(500, greatest(150, p_target * 15)),
            least(240, greatest(s.max_run_minutes, p_target * 6)), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'já existe um pedido de busca aberto; espere terminar ou cancele' using errcode = '23505';
  end;
  return v_id;
end
$$;
revoke execute on function public.admin_search_request(integer) from public, anon, authenticated;
grant execute on function public.admin_search_request(integer) to authenticated;

create or replace function public.admin_search_request_cancel(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update hermes_requests set status = 'cancelado', finished_at = now(), note = 'cancelado no painel'
  where id = p_id and status = 'pendente';
end
$$;
revoke execute on function public.admin_search_request_cancel(uuid) from public, anon, authenticated;
grant execute on function public.admin_search_request_cancel(uuid) to authenticated;

-- PC: há pedido esperando? (só olha, não pega)
create or replace function public.api_search_request_peek(p_token uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q hermes_requests;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  select * into q from hermes_requests where status = 'pendente' order by created_at limit 1;
  if not found then
    return jsonb_build_object('status', 'nenhum');
  end if;
  return jsonb_build_object('status', 'pendente', 'pedido_id', q.id, 'qualificados', q.qualified_target,
    'max_buscas', q.max_searches, 'max_minutos', q.max_minutes);
end
$$;
revoke execute on function public.api_search_request_peek(uuid) from public, anon, authenticated;
grant execute on function public.api_search_request_peek(uuid) to service_role;

-- Início de execução: a rotina "pedido-painel" pega o pedido mais antigo.
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
  v_req hermes_requests;
  v_old uuid;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if coalesce(p_routine, '') !~ '^[a-z0-9-]{3,60}$' then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('routine inválida'));
  end if;
  select * into v_s from prospecting_settings where id = 1;

  for v_old in
    update hermes_runs h
    set status = 'abandonada', finished_at = now(), end_reason = 'tempo limite excedido sem término registrado'
    where h.routine = p_routine and h.status = 'em_andamento'
      and h.started_at < now() - make_interval(mins => coalesce(
            (select q.max_minutes from hermes_requests q where q.id = h.request_id), v_s.max_run_minutes) + 15)
    returning h.id
  loop
    perform hermes_request_close(v_old);
  end loop;

  if p_routine = 'pedido-painel' then
    if exists (select 1 from hermes_runs where routine = p_routine and status = 'em_andamento') then
      select * into v_open from hermes_runs where routine = p_routine and status = 'em_andamento';
      return jsonb_build_object('status', 'ja_em_andamento', 'run_id', v_open.id, 'started_at', v_open.started_at);
    end if;
    select * into v_req from hermes_requests where status = 'pendente' order by created_at limit 1 for update skip locked;
    if not found then
      return jsonb_build_object('status', 'sem_pedido', 'motivo', 'nenhum pedido de busca esperando no painel');
    end if;
    insert into hermes_runs (routine, token_id, config, request_id)
    values (p_routine, p_token, coalesce(p_config, '{}') || jsonb_build_object('stock_ready', v_stock,
            'pedido', v_req.qualified_target, 'max_searches', v_req.max_searches, 'max_run_minutes', v_req.max_minutes), v_req.id)
    returning id into v_run;
    update hermes_requests set status = 'em_andamento', started_at = now(), run_id = v_run where id = v_req.id;
    return jsonb_build_object('status', 'iniciada', 'run_id', v_run, 'stock_ready', v_stock, 'restock', false,
      'pedido', true, 'pedido_id', v_req.id, 'run_target', v_req.qualified_target, 'meta_qualificados', v_req.qualified_target,
      'max_searches', v_req.max_searches, 'max_run_minutes', v_req.max_minutes);
  end if;

  v_restock := case when v_s.restock_enabled and v_stock < v_s.restock_min
                    then least(v_s.restock_min - v_stock, v_s.restock_batch) end;
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

create or replace function public.api_finish_run(p_token uuid, p_run uuid, p jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := coalesce(p ->> 'status', 'concluida');
  v_run hermes_runs;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if v_status not in ('concluida', 'parcial', 'falhou') then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('status deve ser concluida, parcial ou falhou'));
  end if;
  if nullif(btrim(p ->> 'end_reason'), '') is null then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('end_reason obrigatório'));
  end if;
  select * into v_run from hermes_runs where id = p_run and token_id = p_token for update;
  if not found then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('execução não encontrada'));
  end if;
  if v_run.status <> 'em_andamento' then
    return jsonb_build_object('status', 'ja_encerrada', 'run_id', p_run, 'run_status', v_run.status);
  end if;
  update hermes_runs set
    status = v_status,
    finished_at = now(),
    searched = greatest(coalesce((p ->> 'searched')::int, 0), 0),
    approved = greatest(coalesce((p ->> 'approved')::int, 0), 0),
    discarded = greatest(coalesce((p ->> 'discarded')::int, 0), 0),
    errors = greatest(coalesce((p ->> 'errors')::int, 0), 0),
    error_details = coalesce(p -> 'error_details', '[]'),
    end_reason = left(p ->> 'end_reason', 500),
    notes = left(p ->> 'notes', 4000)
  where id = p_run;
  perform hermes_request_close(p_run);
  return jsonb_build_object('status', 'encerrada', 'run_id', p_run,
    'qualificados', case when v_run.request_id is not null then public.hermes_run_qualified(p_run) end);
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
  v_req hermes_requests;
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
    select 1 from hermes_runs h left join hermes_requests q on q.id = h.request_id
    where h.id = p_run and h.started_at < now() - make_interval(mins => coalesce(q.max_minutes, v_settings.max_run_minutes))
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
  if p_run is not null and v_run.request_id is not null then
    -- Pedido do painel ("buscar N qualificados"): para quando bater N
    -- qualificados nesta execução ou cadastrar 4N leads no total. Não conta
    -- na meta diária: foi o Marcos quem pediu.
    select * into v_req from hermes_requests where id = v_run.request_id;
    if public.hermes_run_qualified(p_run) >= v_req.qualified_target
       or v_run.created >= v_req.qualified_target * 4 then
      v_result := jsonb_build_object('status', 'limite_atingido', 'errors', jsonb_build_array('meta do pedido atingida'));
      update idempotency_keys set response = v_result where scope = v_scope and key = p_key;
      return v_result;
    end if;
  elsif p_run is not null and v_run.restock_target is not null then
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
