-- Retomar pedido parado: o Hermes às vezes encerra o turno antes de bater a
-- meta e deixa o pedido "em andamento". O programa do PC só chamava o Hermes
-- com pedido esperando, então a busca ficava parada para sempre.
--
-- Agora, se a execução do pedido fica 15 minutos sem cadastrar nada, o
-- pedido-pendente avisa "retomar" e o start-run devolve a mesma execução
-- ("retomada"), com o que já veio e o que falta. No máximo 3 retomadas; depois
-- disso, ou passado o tempo do pedido, a execução é encerrada e o pedido
-- fechado com o que trouxe.

-- Último sinal de vida de uma execução: início, última retomada ou último cadastro.
create or replace function public.hermes_run_last_activity(p_run uuid) returns timestamptz
language sql stable
security definer
set search_path = public
as $$
  select greatest(h.started_at, (h.config ->> 'retomada_at')::timestamptz,
                  (select max(e.created_at) from lead_evidences e where e.run_id = h.id))
  from hermes_runs h where h.id = p_run
$$;
revoke execute on function public.hermes_run_last_activity(uuid) from public, anon;
grant execute on function public.hermes_run_last_activity(uuid) to authenticated, service_role;

-- Execução de pedido parada que ainda pode ser retomada.
create or replace function public.hermes_run_resumable(h hermes_runs) returns boolean
language sql stable
set search_path = public
as $$
  select h.routine = 'pedido-painel' and h.status = 'em_andamento' and h.request_id is not null
     and coalesce((h.config ->> 'retomadas')::int, 0) < 3
     and public.hermes_run_last_activity(h.id) < now() - interval '15 minutes'
     and h.started_at + make_interval(mins => coalesce(
           (select q.max_minutes from hermes_requests q where q.id = h.request_id), 90)) > now()
$$;
revoke execute on function public.hermes_run_resumable(hermes_runs) from public, anon, authenticated;

-- Fecha execução de pedido parada que não dá mais para retomar (tempo do
-- pedido acabou ou já foi retomada 3 vezes) e fecha o pedido com o que veio.
create or replace function public.hermes_request_tidy() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
begin
  for v_old in
    update hermes_runs h
    set status = 'abandonada', finished_at = now(),
        end_reason = case when coalesce((h.config ->> 'retomadas')::int, 0) >= 3
                          then 'o Hermes parou de novo depois de 3 retomadas'
                          else 'tempo do pedido acabou sem término registrado' end
    where h.routine = 'pedido-painel' and h.status = 'em_andamento' and h.request_id is not null
      and public.hermes_run_last_activity(h.id) < now() - interval '15 minutes'
      and not public.hermes_run_resumable(h)
    returning h.id
  loop
    perform public.hermes_request_close(v_old);
  end loop;
end
$$;
revoke execute on function public.hermes_request_tidy() from public, anon, authenticated;

create or replace function public.api_search_request_peek(p_token uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q hermes_requests;
  h hermes_runs;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  perform public.hermes_request_tidy();
  select * into q from hermes_requests where status = 'pendente' order by created_at limit 1;
  if found then
    return jsonb_build_object('status', 'pendente', 'pedido_id', q.id, 'qualificados', q.qualified_target,
      'max_buscas', q.max_searches, 'max_minutos', q.max_minutes);
  end if;
  select r.* into h from hermes_runs r join hermes_requests x on x.id = r.request_id and x.status = 'em_andamento'
  where public.hermes_run_resumable(r) limit 1;
  if found then
    select * into q from hermes_requests where id = h.request_id;
    return jsonb_build_object('status', 'retomar', 'pedido_id', q.id, 'run_id', h.id,
      'qualificados', q.qualified_target, 'ja_vieram', public.hermes_run_qualified(h.id),
      'max_buscas', q.max_searches, 'max_minutos', q.max_minutes);
  end if;
  return jsonb_build_object('status', 'nenhum');
end
$$;

-- Início de execução: a rotina "pedido-painel" pega o pedido mais antigo ou
-- retoma a execução parada do pedido em andamento.
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
    perform public.hermes_request_tidy();
    if exists (select 1 from hermes_runs where routine = p_routine and status = 'em_andamento') then
      select * into v_open from hermes_runs where routine = p_routine and status = 'em_andamento' for update;
      -- Execução parada há 15 minutos: continua a mesma, com o que já veio.
      if public.hermes_run_resumable(v_open) then
        update hermes_runs set config = config || jsonb_build_object(
            'retomadas', coalesce((config ->> 'retomadas')::int, 0) + 1, 'retomada_at', now())
        where id = v_open.id;
        select * into v_req from hermes_requests where id = v_open.request_id;
        return jsonb_build_object('status', 'retomada', 'run_id', v_open.id, 'pedido', true, 'pedido_id', v_req.id,
          'run_target', v_req.qualified_target, 'meta_qualificados', v_req.qualified_target,
          'ja_vieram', public.hermes_run_qualified(v_open.id),
          'faltam', greatest(0, v_req.qualified_target - public.hermes_run_qualified(v_open.id)),
          'max_searches', v_req.max_searches, 'max_run_minutes', v_req.max_minutes,
          'minutos_restantes', greatest(0, ceil(extract(epoch from
             v_open.started_at + make_interval(mins => v_req.max_minutes) - now()) / 60)::int),
          'retomadas', coalesce((v_open.config ->> 'retomadas')::int, 0) + 1);
      end if;
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
