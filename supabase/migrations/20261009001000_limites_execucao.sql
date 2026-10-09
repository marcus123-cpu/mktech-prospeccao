-- Limites aplicados pelo servidor ao cadastro do Hermes:
--   * no máximo daily_target leads novos de origem Hermes por dia (São Paulo);
--   * nenhum cadastro depois de max_run_minutes do início da execução.
-- Resposta nova: limite_atingido.

-- Cadastro idempotente: a mesma chave com o mesmo conteúdo devolve a mesma
-- resposta; a mesma chave com conteúdo diferente é recusada.
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
  if (select count(*) from leads
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
