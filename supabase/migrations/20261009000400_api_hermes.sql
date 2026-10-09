-- Funções usadas pela API do Hermes. Só o papel service_role (servidor do
-- painel) pode executá-las, e cada uma exige um token válido com o escopo
-- certo. Nenhuma delas altera etapa, contatos, valores ou apaga fichas.

create or replace function public.api_token_check(p_hash text, p_scope text) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update integration_tokens
  set last_used_at = now()
  where token_hash = p_hash and revoked_at is null and p_scope = any (scopes)
  returning id into v_id;
  return v_id;
end
$$;

-- Identificadores já cadastrados, sem dados comerciais.
create or replace function public.api_existing_identifiers(p_token uuid) returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'instagram', coalesce((select jsonb_agg(distinct instagram_handle) from leads where instagram_handle is not null), '[]'),
    'phones', coalesce((select jsonb_agg(distinct phone_e164) from leads where phone_e164 is not null), '[]'),
    'domains', coalesce((select jsonb_agg(distinct website_domain) from leads where website_domain is not null), '[]'),
    'source_ids', coalesce((select jsonb_agg(distinct coalesce(source_name, '') || ':' || source_place_id) from leads where source_place_id is not null), '[]'),
    'names', coalesce((select jsonb_agg(jsonb_build_object('name', business_name, 'city', city, 'unit', unit_label))
                       from leads), '[]')
  )
  where p_token is not null
$$;

-- Consulta de duplicados sem gravar nada. Devolve apenas nome e cidade das
-- fichas encontradas (nunca etapa, contatos ou valores).
create or replace function public.api_check_duplicates(p_token uuid, p jsonb) returns jsonb
language plpgsql stable
security definer
set search_path = public, extensions
as $$
declare
  m jsonb;
  errs text[];
  v_ids uuid[];
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  errs := validate_candidate(p, false);
  if cardinality(errs) > 0 then
    return jsonb_build_object('status', 'invalido', 'errors', to_jsonb(errs));
  end if;
  m := find_lead_matches(p);
  v_ids := coalesce(
    array(select jsonb_array_elements_text(m -> 'matched_lead_ids'))::uuid[],
    '{}'
  ) || case when m ? 'lead_id' then array[(m ->> 'lead_id')::uuid] else '{}'::uuid[] end;
  return jsonb_build_object(
    'status', case m ->> 'decision' when 'existente' then 'existente' when 'revisao' then 'possivel_duplicado' else 'novo' end,
    'matched_on', m -> 'matched_on',
    'reason', m -> 'reason',
    'matches', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'business_name', business_name, 'city', city, 'unit', unit_label))
                         from leads where id = any (v_ids)), '[]'),
    'normalized', m -> 'keys'
  );
end
$$;

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

-- Início de execução. Execuções presas além do limite de tempo são marcadas
-- como abandonadas antes; uma rotina nunca tem duas execuções abertas.
create or replace function public.api_start_run(p_token uuid, p_routine text, p_config jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_run uuid;
  v_open hermes_runs;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if coalesce(p_routine, '') !~ '^[a-z0-9-]{3,60}$' then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('routine inválida'));
  end if;
  select max_run_minutes into v_max from prospecting_settings where id = 1;

  update hermes_runs
  set status = 'abandonada', finished_at = now(), end_reason = 'tempo limite excedido sem término registrado'
  where routine = p_routine and status = 'em_andamento'
    and started_at < now() - make_interval(mins => v_max + 15);

  begin
    insert into hermes_runs (routine, token_id, config)
    values (p_routine, p_token, coalesce(p_config, '{}'))
    returning id into v_run;
  exception when unique_violation then
    select * into v_open from hermes_runs where routine = p_routine and status = 'em_andamento';
    return jsonb_build_object('status', 'ja_em_andamento', 'run_id', v_open.id, 'started_at', v_open.started_at);
  end;
  return jsonb_build_object('status', 'iniciada', 'run_id', v_run);
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
  return jsonb_build_object('status', 'encerrada', 'run_id', p_run);
end
$$;

create or replace function public.api_get_settings(p_token uuid) returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select to_jsonb(s) - 'id' - 'updated_at'
  from prospecting_settings s
  where s.id = 1 and p_token is not null
$$;
