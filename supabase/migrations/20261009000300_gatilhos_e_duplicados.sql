-- Gatilhos de normalização e histórico, e o núcleo do controle de duplicados.

create or replace function public.leads_normalize() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.business_name := btrim(new.business_name);
  new.city := btrim(new.city);
  new.name_norm := norm_text(new.business_name);
  if new.name_norm is null then
    raise exception 'nome comercial inválido' using errcode = '22023';
  end if;
  new.name_core := norm_business_core(new.business_name);
  new.city_norm := coalesce(norm_text(new.city), '');
  new.unit_key := norm_unit(new.unit_label);
  new.instagram_handle := norm_instagram(new.instagram_raw);
  new.phone_e164 := norm_phone(new.phone_raw);
  new.website_domain := norm_domain(new.website_url);
  if is_social_or_link_domain(new.website_domain) then
    new.website_domain := null;
  end if;
  new.source_place_id := nullif(btrim(new.source_place_id), '');
  new.source_name := nullif(btrim(new.source_name), '');
  new.updated_at := now();
  return new;
end
$$;

create trigger leads_normalize
before insert or update on public.leads
for each row execute function public.leads_normalize();

-- Toda mudança de etapa vira um evento. A origem da mudança vem da
-- configuração de sessão app.stage_source (definida pelas funções abaixo).
create or replace function public.leads_stage_history() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into stage_events (lead_id, from_stage, to_stage, note, source)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.stage end,
      new.stage,
      nullif(current_setting('app.stage_note', true), ''),
      coalesce(nullif(current_setting('app.stage_source', true), ''), 'manual')
    );
  end if;
  return null;
end
$$;

create trigger leads_stage_history
after insert or update of stage on public.leads
for each row execute function public.leads_stage_history();

-- Mantém o resumo de contatos da ficha a partir dos eventos válidos.
create or replace function public.refresh_lead_contact(p_lead uuid) returns void
language sql
set search_path = public
as $$
  update leads l
  set contacted = s.total > 0,
      contact_date_unknown = s.total > 0 and s.dated = 0,
      first_contact_at = s.first_at,
      last_contact_at = s.last_at,
      contact_count = s.total
  from (
    select count(*) as total,
           count(occurred_at) as dated,
           min(occurred_at) as first_at,
           max(occurred_at) as last_at
    from contact_events
    where lead_id = p_lead and voided_at is null
  ) s
  where l.id = p_lead
$$;

create or replace function public.contact_events_refresh() returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform refresh_lead_contact(new.lead_id);
  return null;
end
$$;

create trigger contact_events_refresh
after insert or update on public.contact_events
for each row execute function public.contact_events_refresh();

-- Chaves normalizadas de um candidato (JSON vindo da API, importação ou painel).
create or replace function public.candidate_keys(p jsonb) returns jsonb
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_domain text := norm_domain(p ->> 'website_url');
begin
  if is_social_or_link_domain(v_domain) then
    v_domain := null;
  end if;
  return jsonb_build_object(
    'instagram', norm_instagram(p ->> 'instagram'),
    'phone', norm_phone(p ->> 'phone'),
    'domain', v_domain,
    'source_name', coalesce(nullif(btrim(p ->> 'source_name'), ''), ''),
    'place_id', nullif(btrim(p ->> 'source_place_id'), ''),
    'name_core', norm_business_core(p ->> 'business_name'),
    'name_norm', norm_text(p ->> 'business_name'),
    'city', coalesce(norm_text(p ->> 'city'), ''),
    'unit', norm_unit(p ->> 'unit_label')
  );
end
$$;

-- Nome e local compatíveis com uma ficha existente (usado quando telefone ou
-- domínio coincidem). Identificadores fortes divergentes impedem a fusão.
create or replace function public.lead_compatible(l public.leads, k jsonb) returns boolean
language sql stable
set search_path = public, extensions
as $$
  select l.city_norm = k ->> 'city'
     and l.unit_key = k ->> 'unit'
     and (l.instagram_handle is null or k ->> 'instagram' is null or l.instagram_handle = k ->> 'instagram')
     and (l.source_place_id is null or k ->> 'place_id' is null
          or (l.source_place_id = k ->> 'place_id' and coalesce(l.source_name, '') = k ->> 'source_name'))
     and (
       l.name_core = k ->> 'name_core'
       or extensions.similarity(l.name_core, k ->> 'name_core') >= 0.5
       or (length(k ->> 'name_core') >= 4 and position(k ->> 'name_core' in l.name_core) > 0)
       or (length(l.name_core) >= 4 and position(l.name_core in k ->> 'name_core') > 0)
     )
$$;

-- Decide o destino de um candidato sem gravar nada:
--   existente: mesma ficha identificada com segurança;
--   revisao:   sinal de duplicidade que exige decisão humana;
--   novo:      nenhum sinal encontrado.
create or replace function public.find_lead_matches(p jsonb) returns jsonb
language plpgsql stable
set search_path = public, extensions
as $$
declare
  k jsonb := candidate_keys(p);
  v_place_lead uuid;
  v_ids uuid[];
  v_same uuid[];
begin
  if k ->> 'place_id' is not null then
    select id into v_place_lead
    from leads
    where coalesce(source_name, '') = k ->> 'source_name' and source_place_id = k ->> 'place_id';
  end if;

  if k ->> 'instagram' is not null then
    select array_agg(id order by created_at) into v_ids from leads where instagram_handle = k ->> 'instagram';
  end if;

  if v_place_lead is not null then
    if (v_ids is null or v_place_lead = any (v_ids))
       and not exists (
         select 1 from leads
         where id = v_place_lead and instagram_handle is not null
           and k ->> 'instagram' is not null and instagram_handle <> k ->> 'instagram'
       ) then
      return jsonb_build_object('decision', 'existente', 'lead_id', v_place_lead, 'matched_on', 'fonte', 'keys', k);
    end if;
    return jsonb_build_object('decision', 'revisao', 'reason', 'sinais_conflitantes', 'matched_on', 'fonte',
      'matched_lead_ids', to_jsonb(array[v_place_lead] || v_ids), 'keys', k);
  end if;

  if v_ids is not null then
    select array_agg(id) into v_same from leads where id = any (v_ids) and unit_key = k ->> 'unit';
    if v_same is not null then
      return jsonb_build_object('decision', 'existente', 'lead_id', v_same[1], 'matched_on', 'instagram', 'keys', k);
    end if;
    return jsonb_build_object('decision', 'revisao', 'reason', 'instagram_outra_unidade', 'matched_on', 'instagram',
      'matched_lead_ids', to_jsonb(v_ids), 'keys', k);
  end if;

  if k ->> 'phone' is not null then
    select array_agg(id order by created_at) into v_ids from leads where phone_e164 = k ->> 'phone';
    if v_ids is not null then
      select array_agg(l.id) into v_same from leads l where l.id = any (v_ids) and lead_compatible(l, k);
      if coalesce(array_length(v_same, 1), 0) = 1 then
        return jsonb_build_object('decision', 'existente', 'lead_id', v_same[1], 'matched_on', 'telefone', 'keys', k);
      end if;
      return jsonb_build_object('decision', 'revisao', 'reason', 'telefone_compartilhado', 'matched_on', 'telefone',
        'matched_lead_ids', to_jsonb(v_ids), 'keys', k);
    end if;
  end if;

  if k ->> 'domain' is not null then
    select array_agg(id order by created_at) into v_ids from leads where website_domain = k ->> 'domain';
    if v_ids is not null then
      select array_agg(l.id) into v_same from leads l where l.id = any (v_ids) and lead_compatible(l, k);
      if coalesce(array_length(v_same, 1), 0) = 1 then
        return jsonb_build_object('decision', 'existente', 'lead_id', v_same[1], 'matched_on', 'dominio', 'keys', k);
      end if;
      return jsonb_build_object('decision', 'revisao', 'reason', 'dominio_compartilhado', 'matched_on', 'dominio',
        'matched_lead_ids', to_jsonb(v_ids), 'keys', k);
    end if;
  end if;

  if k ->> 'name_core' is not null then
    select array_agg(id order by created_at) into v_ids
    from leads
    where city_norm = k ->> 'city'
      and (name_core = k ->> 'name_core' or extensions.similarity(name_core, k ->> 'name_core') >= 0.6);
    if v_ids is not null then
      return jsonb_build_object('decision', 'revisao', 'reason', 'nome_parecido', 'matched_on', 'nome_cidade',
        'matched_lead_ids', to_jsonb(v_ids), 'keys', k);
    end if;
  end if;

  return jsonb_build_object('decision', 'novo', 'keys', k);
end
$$;

-- Validação de um candidato. p_strict exige o padrão do Hermes: contato
-- comercial normalizável, motivo da seleção e pelo menos uma evidência.
-- Fora do modo estrito (importação e painel), telefone/Instagram/site que não
-- puderem ser normalizados são guardados como texto original, sem descartar a linha.
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
    if norm_phone(p ->> 'phone') is null and norm_instagram(p ->> 'instagram') is null then
      errs := array_append(errs, 'informe telefone ou Instagram comercial'::text);
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

create or replace function public.insert_evidences(p_lead uuid, p jsonb, p_run uuid) returns void
language sql
set search_path = public
as $$
  insert into lead_evidences (lead_id, kind, url, summary, observed_at, limitation, run_id)
  select p_lead,
         ev ->> 'kind',
         nullif(ev ->> 'url', ''),
         ev ->> 'summary',
         coalesce(nullif(ev ->> 'observed_at', '')::timestamptz, now()),
         nullif(ev ->> 'limitation', ''),
         p_run
  from jsonb_array_elements(coalesce(p -> 'evidences', '[]'::jsonb)) ev
$$;

-- Acrescenta evidências a uma ficha existente e preenche apenas campos
-- factuais vazios. Etapa, contatos, observações e valores nunca mudam aqui.
create or replace function public.merge_into_existing(p_lead uuid, p jsonb, p_run uuid) returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  k jsonb := candidate_keys(p);
  v_new_site site_status := nullif(p ->> 'site_status', '')::site_status;
begin
  perform insert_evidences(p_lead, p, p_run);
  update leads l set
    responsible_name = coalesce(l.responsible_name, nullif(btrim(p ->> 'responsible_name'), '')),
    niche = coalesce(l.niche, nullif(btrim(p ->> 'niche'), '')),
    services = case when cardinality(l.services) = 0 and p ? 'services'
                    then array(select jsonb_array_elements_text(p -> 'services')) else l.services end,
    neighborhood = coalesce(l.neighborhood, nullif(btrim(p ->> 'neighborhood'), '')),
    whatsapp_url = coalesce(l.whatsapp_url, nullif(btrim(p ->> 'whatsapp_url'), '')),
    phone_raw = case when l.phone_e164 is null and k ->> 'phone' is not null then p ->> 'phone' else l.phone_raw end,
    instagram_raw = case
      when l.instagram_handle is null and k ->> 'instagram' is not null
           and not exists (select 1 from leads o where o.instagram_handle = k ->> 'instagram' and o.unit_key = l.unit_key)
      then p ->> 'instagram' else l.instagram_raw end,
    website_url = case when l.website_url is null and k ->> 'domain' is not null then p ->> 'website_url' else l.website_url end,
    source_name = case when l.source_place_id is null and k ->> 'place_id' is not null
                       and not exists (select 1 from leads o where coalesce(o.source_name, '') = k ->> 'source_name' and o.source_place_id = k ->> 'place_id')
                       then nullif(k ->> 'source_name', '') else l.source_name end,
    source_place_id = case when l.source_place_id is null and k ->> 'place_id' is not null
                       and not exists (select 1 from leads o where coalesce(o.source_name, '') = k ->> 'source_name' and o.source_place_id = k ->> 'place_id')
                       then k ->> 'place_id' else l.source_place_id end,
    research_date = greatest(l.research_date, nullif(p ->> 'research_date', '')::date),
    site_status = case when l.site_status = 'verificacao_pendente' and v_new_site is not null then v_new_site else l.site_status end
  where l.id = p_lead;
end
$$;

-- Trava, por chave normalizada, candidatos concorrentes que possam ser o
-- mesmo negócio. Ordenar as chaves evita deadlock.
create or replace function public.lock_candidate_keys(k jsonb) returns void
language plpgsql
set search_path = public
as $$
declare
  key text;
begin
  for key in
    select x from unnest(array[
      'ig:' || (k ->> 'instagram'),
      'ph:' || (k ->> 'phone'),
      'dm:' || (k ->> 'domain'),
      'pl:' || (k ->> 'source_name') || ':' || (k ->> 'place_id'),
      'nm:' || (k ->> 'city') || ':' || (k ->> 'name_core')
    ]) x
    where x is not null
    order by x
  loop
    perform pg_advisory_xact_lock(hashtextextended(key, 0));
  end loop;
end
$$;

-- Cadastro de candidato com controle de duplicados. Retorna:
--   criado | existente | possivel_duplicado | invalido
-- p_force (somente painel) cria mesmo com sinal fraco de duplicidade; as
-- restrições únicas de Instagram/unidade e identificador da fonte continuam valendo.
create or replace function public.register_candidate(
  p jsonb, p_origin lead_origin, p_run uuid, p_strict boolean, p_force boolean default false
) returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  errs text[];
  k jsonb;
  m jsonb;
  v_lead uuid;
  v_review uuid;
  v_fp text;
begin
  errs := validate_candidate(p, p_strict);
  if cardinality(errs) > 0 then
    return jsonb_build_object('status', 'invalido', 'errors', to_jsonb(errs));
  end if;

  k := candidate_keys(p);
  perform lock_candidate_keys(k);
  m := find_lead_matches(p);

  if m ->> 'decision' = 'existente' then
    v_lead := (m ->> 'lead_id')::uuid;
    perform merge_into_existing(v_lead, p, p_run);
    insert into dedupe_events (outcome, lead_id, matched_on, origin, run_id)
    values ('existente', v_lead, m ->> 'matched_on', p_origin, p_run);
    return jsonb_build_object('status', 'existente', 'lead_id', v_lead, 'matched_on', m ->> 'matched_on');
  end if;

  if m ->> 'decision' = 'revisao' and not p_force then
    v_fp := md5(concat_ws('|', k ->> 'name_norm', k ->> 'city', k ->> 'unit', k ->> 'phone', k ->> 'instagram',
                          k ->> 'domain', k ->> 'place_id'));
    insert into duplicate_reviews (fingerprint, candidate, business_name, city, reason, matched_lead_ids, origin, run_id)
    values (v_fp, p, p ->> 'business_name', p ->> 'city', m ->> 'reason',
            array(select jsonb_array_elements_text(m -> 'matched_lead_ids'))::uuid[], p_origin, p_run)
    on conflict (fingerprint) where status = 'pendente' do nothing
    returning id into v_review;
    if v_review is null then
      select id into v_review from duplicate_reviews where fingerprint = v_fp and status = 'pendente';
    end if;
    insert into dedupe_events (outcome, review_id, matched_on, origin, run_id)
    values ('revisao', v_review, m ->> 'matched_on', p_origin, p_run);
    return jsonb_build_object('status', 'possivel_duplicado', 'review_id', v_review, 'reason', m ->> 'reason',
                              'matched_lead_ids', m -> 'matched_lead_ids');
  end if;

  begin
    perform set_config('app.stage_source', p_origin::text, true);
    insert into leads (
      business_name, responsible_name, niche, services, city, state, neighborhood, unit_label,
      phone_raw, instagram_raw, whatsapp_url, website_url, source_name, source_place_id,
      research_date, selection_reason, pending_items, priority, site_status, origin
    ) values (
      p ->> 'business_name',
      nullif(btrim(p ->> 'responsible_name'), ''),
      nullif(btrim(p ->> 'niche'), ''),
      coalesce(array(select jsonb_array_elements_text(p -> 'services')), '{}'),
      p ->> 'city',
      coalesce(nullif(p ->> 'state', ''), 'SP'),
      nullif(btrim(p ->> 'neighborhood'), ''),
      nullif(btrim(p ->> 'unit_label'), ''),
      nullif(btrim(p ->> 'phone'), ''),
      nullif(btrim(p ->> 'instagram'), ''),
      nullif(btrim(p ->> 'whatsapp_url'), ''),
      nullif(btrim(p ->> 'website_url'), ''),
      nullif(btrim(p ->> 'source_name'), ''),
      nullif(btrim(p ->> 'source_place_id'), ''),
      coalesce(nullif(p ->> 'research_date', '')::date, (now() at time zone 'America/Sao_Paulo')::date),
      nullif(btrim(p ->> 'selection_reason'), ''),
      nullif(btrim(p ->> 'pending_items'), ''),
      coalesce(nullif(p ->> 'priority', ''), 'media')::lead_priority,
      coalesce(nullif(p ->> 'site_status', ''), 'verificacao_pendente')::site_status,
      p_origin
    ) returning id into v_lead;
    perform set_config('app.stage_source', '', true);
  exception when unique_violation then
    -- Proteção final: outra transação gravou a mesma chave forte.
    m := find_lead_matches(p);
    if m ->> 'decision' = 'existente' then
      insert into dedupe_events (outcome, lead_id, matched_on, origin, run_id)
      values ('existente', (m ->> 'lead_id')::uuid, m ->> 'matched_on', p_origin, p_run);
      return jsonb_build_object('status', 'existente', 'lead_id', m ->> 'lead_id', 'matched_on', m ->> 'matched_on');
    end if;
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('conflito com registro existente'));
  end;

  perform insert_evidences(v_lead, p, p_run);
  return jsonb_build_object('status', 'criado', 'lead_id', v_lead);
end
$$;
