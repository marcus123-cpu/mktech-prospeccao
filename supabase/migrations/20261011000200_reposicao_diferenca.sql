-- Reposição até restock_min (a diferença, não um lote fixo) e estoque que conta
-- tudo que ainda não saiu para o lead.
--
-- Pronto para abordar: lead novo, sem contato, com WhatsApp, nota 60 ou mais,
-- com diagnóstico, que não pediu para parar e que ainda NÃO recebeu saudação.
-- Mensagem já escrita esperando na fila ("pronta") continua contando; só deixa
-- de contar quando a saudação começa a ser enviada.
--
-- A meta da pesquisa é restock_min menos o estoque (10 prontos -> busca 10 para
-- voltar a 20). restock_batch continua como teto por execução.

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
    and not exists (
      select 1 from public.outreach_messages m
      where m.lead_id = l.id and m.status not in ('cancelada', 'pronta')
    )
$$;

create or replace function public.api_get_settings(p_token uuid) returns jsonb
language sql stable
security definer
set search_path = public
as $$
  with st as (select public.prospecting_stock() as n)
  select to_jsonb(s) - 'id' - 'updated_at'
         || jsonb_build_object(
              'stock_ready', st.n,
              'restock_needed', s.restock_enabled and st.n < s.restock_min,
              'run_target', case when s.restock_enabled and st.n < s.restock_min
                                 then least(s.restock_min - st.n, s.restock_batch) else s.daily_target end)
  from prospecting_settings s, st
  where s.id = 1 and p_token is not null
$$;

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
  v_restock := case when v_s.restock_enabled and v_stock < v_s.restock_min
                    then least(v_s.restock_min - v_stock, v_s.restock_batch) end;

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
