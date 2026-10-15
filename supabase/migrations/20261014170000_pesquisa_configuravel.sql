-- Pesquisa configurável: nicho livre, localização (Brasil/estado/cidade),
-- meta de 1 a 1000 leads novos e relatório com motivos de descarte.
-- A meta é um alvo: o Hermes entrega o que achou dentro dos limites e explica a diferença.

alter table public.hermes_requests drop constraint hermes_requests_qualified_target_check;
alter table public.hermes_requests add constraint hermes_requests_qualified_target_check check (qualified_target between 1 and 1000);
alter table public.hermes_requests drop constraint hermes_requests_max_searches_check;
alter table public.hermes_requests add constraint hermes_requests_max_searches_check check (max_searches between 10 and 5000);
alter table public.hermes_requests drop constraint hermes_requests_max_minutes_check;
alter table public.hermes_requests add constraint hermes_requests_max_minutes_check check (max_minutes between 5 and 600);
alter table public.hermes_requests add column niche text check (niche is null or length(btrim(niche)) between 2 and 100);
alter table public.hermes_requests add column location_scope text not null default 'brasil' check (location_scope in ('brasil','estado','cidade'));
alter table public.hermes_requests add column location_state text check (location_state is null or location_state ~ '^[A-Z]{2}$');
alter table public.hermes_requests add column location_city text check (location_city is null or length(btrim(location_city)) between 2 and 120);
alter table public.hermes_requests add constraint hermes_requests_location_check check (
  (location_scope = 'brasil' and location_state is null and location_city is null)
  or (location_scope = 'estado' and location_state is not null and location_city is null)
  or (location_scope = 'cidade' and location_state is not null and location_city is not null));

alter table public.hermes_runs add column discard_reasons jsonb not null default '{}';

-- Descartes registrados pelo servidor (por que uma empresa analisada não virou lead).
create table public.hermes_run_discards (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.hermes_runs(id) on delete cascade,
  business_name text,
  reason_code text not null,
  reason text not null check (length(reason) <= 500),
  created_at timestamptz not null default now()
);
create index hermes_run_discards_run_idx on public.hermes_run_discards(run_id);
alter table public.hermes_run_discards enable row level security;
revoke all on public.hermes_run_discards from anon, authenticated;
grant select on public.hermes_run_discards to authenticated;
grant all on public.hermes_run_discards to service_role;
create policy admin_le on public.hermes_run_discards for select to authenticated using (public.is_admin());

-- Leads novos entregues pela execução: nota baixa, telefone fixo, sem WhatsApp ou dados
-- incompletos NÃO desqualificam; o lead entra para enriquecimento posterior.
create or replace function public.hermes_run_qualified(p_run uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from leads l join hermes_runs h on h.id = p_run
  where l.origin = 'hermes' and l.created_at >= h.started_at
    and exists (select 1 from lead_evidences e where e.lead_id = l.id and e.run_id = p_run)
$$;

create or replace function public.admin_search_request_v2(p_target integer, p_niche text, p_scope text, p_state text, p_city text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s prospecting_settings; v_id uuid; v_niche text := btrim(coalesce(p_niche, ''));
  v_state text := nullif(upper(btrim(coalesce(p_state, ''))), ''); v_city text := nullif(btrim(coalesce(p_city, '')), '');
  ufs constant text[] := array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
begin
  perform require_admin();
  if p_target is null or p_target not between 1 and 1000 then
    raise exception 'quantidade deve ser um inteiro de 1 a 1000' using errcode = '22023';
  end if;
  if length(v_niche) not between 2 and 100 then
    raise exception 'informe o nicho (2 a 100 caracteres)' using errcode = '22023';
  end if;
  if coalesce(p_scope, '') not in ('brasil', 'estado', 'cidade') then
    raise exception 'localização inválida' using errcode = '22023';
  end if;
  if p_scope = 'brasil' then v_state := null; v_city := null; end if;
  if p_scope = 'estado' then
    v_city := null;
    if v_state is null or not v_state = any(ufs) then raise exception 'escolha o estado' using errcode = '22023'; end if;
  end if;
  if p_scope = 'cidade' and (v_city is null or v_state is null or not v_state = any(ufs)) then
    raise exception 'informe cidade e estado' using errcode = '22023';
  end if;
  select * into s from prospecting_settings where id = 1;
  begin
    insert into hermes_requests (qualified_target, max_searches, max_minutes, created_by, niche, location_scope, location_state, location_city)
    values (p_target, least(5000, greatest(150, p_target * 15)),
            least(600, greatest(s.max_run_minutes, p_target * 6)), auth.uid(), v_niche, p_scope, v_state, v_city)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'já existe um pedido de busca aberto; espere terminar ou cancele' using errcode = '23505';
  end;
  return v_id;
end $$;
revoke execute on function public.admin_search_request_v2(integer, text, text, text, text) from public, anon, service_role;
grant execute on function public.admin_search_request_v2(integer, text, text, text, text) to authenticated;
-- A assinatura antiga não define nicho nem localização: fica fechada para o painel.
revoke execute on function public.admin_search_request(integer) from authenticated;

-- O pedido entrega ao Hermes o nicho e a localização da própria pesquisa.
create or replace function public.hermes_request_scope(p_request uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('niche', q.niche, 'location_scope', q.location_scope,
    'location_state', q.location_state, 'location_city', q.location_city)
  from hermes_requests q where q.id = p_request
$$;
revoke execute on function public.hermes_request_scope(uuid) from public, anon, authenticated;

alter function public.api_search_request_peek(uuid) rename to api_search_request_peek_before_scope;
revoke execute on function public.api_search_request_peek_before_scope(uuid) from public, anon, authenticated, service_role;
create function public.api_search_request_peek(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.api_search_request_peek_before_scope(p_token);
  if r ? 'pedido_id' then r := r || public.hermes_request_scope((r ->> 'pedido_id')::uuid); end if;
  return r;
end $$;
revoke execute on function public.api_search_request_peek(uuid) from public, anon, authenticated;
grant execute on function public.api_search_request_peek(uuid) to service_role;

alter function public.api_start_run(uuid, text, jsonb) rename to api_start_run_before_scope;
revoke execute on function public.api_start_run_before_scope(uuid, text, jsonb) from public, anon, authenticated, service_role;
create function public.api_start_run(p_token uuid, p_routine text, p_config jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.api_start_run_before_scope(p_token, p_routine, p_config);
  if r ? 'pedido_id' then r := r || public.hermes_request_scope((r ->> 'pedido_id')::uuid); end if;
  return r;
end $$;
revoke execute on function public.api_start_run(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.api_start_run(uuid, text, jsonb) to service_role;

-- Encerramento guarda os motivos de descarte informados pelo Hermes.
alter function public.api_finish_run(uuid, uuid, jsonb) rename to api_finish_run_before_reasons;
revoke execute on function public.api_finish_run_before_reasons(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
create function public.api_finish_run(p_token uuid, p_run uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.api_finish_run_before_reasons(p_token, p_run, p - 'discard_reasons');
  if r ->> 'status' = 'encerrada' and jsonb_typeof(p -> 'discard_reasons') = 'object' then
    update hermes_runs set discard_reasons = p -> 'discard_reasons' where id = p_run;
  end if;
  return r;
end $$;
revoke execute on function public.api_finish_run(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.api_finish_run(uuid, uuid, jsonb) to service_role;

-- Relatório da execução: encontradas, salvas, atualizadas, pendentes e descartadas com motivos.
create or replace function public.hermes_run_report(p_run uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare h hermes_runs; q hermes_requests; reasons jsonb; v_created integer; v_pending integer; v_target integer;
begin
  select * into h from hermes_runs where id = p_run;
  if h.id is null then return null; end if;
  select * into q from hermes_requests where id = h.request_id;
  select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', n) order by n desc), '[]') into reasons from (
    select reason, sum(n)::int n from (
      select reason, count(*) n from hermes_run_discards where run_id = p_run group by reason
      union all select key, value::int from jsonb_each_text(h.discard_reasons) where value ~ '^\d+$'
    ) x group by reason) y;
  v_created := public.hermes_run_qualified(p_run);
  select count(*)::int into v_pending from leads l
  where l.origin = 'hermes' and l.created_at >= h.started_at
    and exists (select 1 from lead_evidences e where e.lead_id = l.id and e.run_id = p_run)
    and (l.phone_e164 is null or l.site_status = 'verificacao_pendente'
         or not exists (select 1 from lead_diagnoses d where d.lead_id = l.id));
  v_target := coalesce(q.qualified_target, h.restock_target);
  return jsonb_build_object('run_id', h.id, 'status', h.status, 'niche', q.niche, 'location_scope', q.location_scope,
    'location_state', q.location_state, 'location_city', q.location_city, 'target', v_target,
    'analyzed', greatest(h.searched, h.created + h.existing + h.possible_duplicates + h.invalid + h.discarded),
    'saved', v_created, 'updated', h.existing, 'pending_review', h.possible_duplicates, 'pending_enrichment', v_pending,
    'discarded', greatest(h.discarded, h.invalid), 'errors', h.errors, 'discard_reasons', reasons,
    'shortfall', case when v_target is not null and v_created < v_target and h.status <> 'em_andamento'
                      then jsonb_build_object('missing', v_target - v_created, 'reason', h.end_reason) end);
end $$;
revoke execute on function public.hermes_run_report(uuid) from public, anon, authenticated;
grant execute on function public.hermes_run_report(uuid) to service_role;

create function public.admin_run_report(p_run uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  return public.hermes_run_report(p_run);
end $$;
revoke execute on function public.admin_run_report(uuid) from public, anon, service_role;
grant execute on function public.admin_run_report(uuid) to authenticated;

-- Cadastro aceita candidato incompleto (sem telefone/Instagram) quando há outro identificador.
create or replace function public.validate_candidate(p jsonb, p_strict boolean) returns text[]
language plpgsql stable
set search_path = public, extensions
as $$
declare
  errs text[] := '{}';
  ev jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    return array['payload deve ser um objeto'];
  end if;
  if norm_text(p ->> 'business_name') is null or length(p ->> 'business_name') > 200 then
    errs := array_append(errs, 'business_name obrigatório (até 200 caracteres)'::text);
  end if;
  if norm_text(p ->> 'city') is null or length(p ->> 'city') > 120 then
    errs := array_append(errs, 'city obrigatória'::text);
  end if;
  if p ? 'state' and coalesce(p ->> 'state', '') !~ '^[A-Z]{2}$' then
    errs := array_append(errs, 'state deve ter 2 letras maiúsculas'::text);
  end if;
  if p ? 'priority' and coalesce(p ->> 'priority', '') not in ('alta', 'media', 'baixa') then
    errs := array_append(errs, 'priority inválida'::text);
  end if;
  if p ? 'site_status' and coalesce(p ->> 'site_status', '') not in
     ('site_proprio_encontrado', 'site_nao_localizado', 'apenas_redes_sociais', 'verificacao_pendente') then
    errs := array_append(errs, 'site_status inválido'::text);
  end if;
  if p ? 'research_date' and (p ->> 'research_date') !~ '^\d{4}-\d{2}-\d{2}$' then
    errs := array_append(errs, 'research_date deve ser AAAA-MM-DD'::text);
  end if;
  if p ? 'services' and jsonb_typeof(p -> 'services') <> 'array' then
    errs := array_append(errs, 'services deve ser uma lista'::text);
  end if;
  if p_strict and nullif(p ->> 'phone', '') is not null and norm_phone(p ->> 'phone') is null then
    errs := array_append(errs, 'phone não reconhecido (informe DDD)'::text);
  end if;
  if p_strict and nullif(p ->> 'instagram', '') is not null and norm_instagram(p ->> 'instagram') is null then
    errs := array_append(errs, 'instagram não reconhecido'::text);
  end if;
  if p_strict and nullif(p ->> 'website_url', '') is not null and norm_domain(p ->> 'website_url') is null then
    errs := array_append(errs, 'website_url inválida'::text);
  end if;
  if p ? 'evidences' then
    if jsonb_typeof(p -> 'evidences') <> 'array' then
      errs := array_append(errs, 'evidences deve ser uma lista'::text);
    else
      for ev in select * from jsonb_array_elements(p -> 'evidences') loop
        if coalesce(ev ->> 'kind', '') not in ('site', 'instagram', 'google', 'whatsapp', 'diretorio', 'busca', 'outro') then
          errs := array_append(errs, 'evidence.kind inválido'::text);
        end if;
        if nullif(btrim(ev ->> 'summary'), '') is null or length(ev ->> 'summary') > 2000 then
          errs := array_append(errs, 'evidence.summary obrigatório (até 2000 caracteres)'::text);
        end if;
        if nullif(ev ->> 'url', '') is not null and (ev ->> 'url') !~* '^https?://' then
          errs := array_append(errs, 'evidence.url deve começar com http(s)://'::text);
        end if;
        if nullif(ev ->> 'observed_at', '') is not null and (ev ->> 'observed_at') !~ '^\d{4}-\d{2}-\d{2}' then
          errs := array_append(errs, 'evidence.observed_at inválido'::text);
        end if;
      end loop;
    end if;
  end if;
  if p_strict then
    -- Dados incompletos são aceitos para enriquecimento: basta algum identificador do negócio.
    if norm_phone(p ->> 'phone') is null and norm_instagram(p ->> 'instagram') is null
       and nullif(btrim(p ->> 'address'), '') is null and nullif(btrim(p ->> 'source_place_id'), '') is null
       and nullif(btrim(p ->> 'website_url'), '') is null then
      errs := array_append(errs, 'informe telefone, Instagram, endereço, site ou identificador da fonte'::text);
    end if;
    if nullif(btrim(p ->> 'selection_reason'), '') is null then
      errs := array_append(errs, 'selection_reason obrigatório'::text);
    end if;
    if jsonb_array_length(coalesce(nullif(p -> 'evidences', 'null'::jsonb), '[]'::jsonb)) = 0 then
      errs := array_append(errs, 'pelo menos uma evidência é obrigatória'::text);
    end if;
  end if;
  return errs;
end
$$;
