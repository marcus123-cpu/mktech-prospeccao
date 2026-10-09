-- Funções do painel. Todas exigem um administrador autenticado (app_admins)
-- e registram histórico; nenhuma envia mensagens.

create or replace function public.is_admin() returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from app_admins where user_id = auth.uid())
$$;

create or replace function public.require_admin() returns void
language plpgsql stable
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
end
$$;

create or replace function public.admin_create_lead(p jsonb, p_force boolean default false) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_admin();
  return register_candidate(p, 'manual', null, false, p_force);
end
$$;

-- Edição de dados cadastrais (não comerciais).
create or replace function public.admin_update_lead(p_lead uuid, p jsonb) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  errs text[];
begin
  perform require_admin();
  errs := validate_candidate(p, false);
  if cardinality(errs) > 0 then
    return jsonb_build_object('status', 'invalido', 'errors', to_jsonb(errs));
  end if;
  update leads set
    business_name = p ->> 'business_name',
    responsible_name = nullif(btrim(p ->> 'responsible_name'), ''),
    niche = nullif(btrim(p ->> 'niche'), ''),
    services = coalesce(array(select jsonb_array_elements_text(p -> 'services')), '{}'),
    city = p ->> 'city',
    state = coalesce(nullif(p ->> 'state', ''), state),
    neighborhood = nullif(btrim(p ->> 'neighborhood'), ''),
    unit_label = nullif(btrim(p ->> 'unit_label'), ''),
    phone_raw = nullif(btrim(p ->> 'phone'), ''),
    instagram_raw = nullif(btrim(p ->> 'instagram'), ''),
    whatsapp_url = nullif(btrim(p ->> 'whatsapp_url'), ''),
    website_url = nullif(btrim(p ->> 'website_url'), ''),
    pending_items = nullif(btrim(p ->> 'pending_items'), ''),
    selection_reason = nullif(btrim(p ->> 'selection_reason'), ''),
    priority = coalesce(nullif(p ->> 'priority', '')::lead_priority, priority),
    site_status = coalesce(nullif(p ->> 'site_status', '')::site_status, site_status)
  where id = p_lead;
  if not found then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('lead não encontrado'));
  end if;
  return jsonb_build_object('status', 'atualizado', 'lead_id', p_lead);
exception when unique_violation then
  return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('Instagram/unidade ou identificador da fonte já pertence a outro lead'));
end
$$;

create or replace function public.set_stage(p_lead uuid, p_stage lead_stage, p_note text, p_source text) returns void
language plpgsql
set search_path = public
as $$
begin
  perform set_config('app.stage_source', p_source, true);
  perform set_config('app.stage_note', coalesce(p_note, ''), true);
  update leads set stage = p_stage where id = p_lead and stage is distinct from p_stage;
  perform set_config('app.stage_source', '', true);
  perform set_config('app.stage_note', '', true);
end
$$;

-- Registro de contato realizado. Abrir o WhatsApp não chama esta função;
-- só o botão "Marcar como contatado".
create or replace function public.admin_mark_contacted(
  p_lead uuid, p_occurred_at timestamptz default now(), p_channel text default 'whatsapp', p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform require_admin();
  if p_occurred_at is null or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'data do contato inválida' using errcode = '22023';
  end if;
  insert into contact_events (lead_id, occurred_at, channel, note, source, created_by)
  values (p_lead, p_occurred_at, coalesce(p_channel, 'whatsapp'), p_note, 'manual', auth.uid())
  returning id into v_id;
  if (select stage from leads where id = p_lead) = 'novo' then
    perform set_stage(p_lead, 'contatado', null, 'contato');
  end if;
  return v_id;
end
$$;

-- Correção de contato: anula o evento (sem apagar) e, se informado, registra
-- a data correta como novo evento ligado ao original.
create or replace function public.admin_correct_contact(
  p_event uuid, p_reason text, p_new_occurred_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev contact_events;
  v_new uuid;
begin
  perform require_admin();
  if nullif(btrim(p_reason), '') is null then
    raise exception 'informe o motivo da correção' using errcode = '22023';
  end if;
  select * into v_ev from contact_events where id = p_event for update;
  if not found or v_ev.voided_at is not null then
    raise exception 'evento inexistente ou já corrigido' using errcode = '22023';
  end if;
  update contact_events set voided_at = now(), void_reason = p_reason where id = p_event;
  if p_new_occurred_at is not null then
    insert into contact_events (lead_id, occurred_at, channel, note, source, corrects_event_id, created_by)
    values (v_ev.lead_id, p_new_occurred_at, v_ev.channel, v_ev.note, 'manual', p_event, auth.uid())
    returning id into v_new;
  end if;
  if not (select contacted from leads where id = v_ev.lead_id)
     and (select stage from leads where id = v_ev.lead_id) = 'contatado' then
    perform set_stage(v_ev.lead_id, 'novo', 'correção de contato: ' || p_reason, 'correcao');
  end if;
  return jsonb_build_object('voided', p_event, 'replacement', v_new);
end
$$;

create or replace function public.admin_change_stage(p_lead uuid, p_stage lead_stage, p_note text default null, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  if p_stage = 'fechado' then
    raise exception 'use "Registrar fechamento" para informar valor e data' using errcode = '22023';
  end if;
  if p_stage in ('sem_interesse', 'desqualificado') then
    if nullif(btrim(p_reason), '') is null then
      raise exception 'informe o motivo' using errcode = '22023';
    end if;
    update leads set loss_reason = p_reason where id = p_lead;
  end if;
  perform set_stage(p_lead, p_stage, p_note, 'manual');
end
$$;

create or replace function public.admin_add_note(p_lead uuid, p_body text) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform require_admin();
  insert into lead_notes (lead_id, body, created_by) values (p_lead, btrim(p_body), auth.uid()) returning id into v_id;
  return v_id;
end
$$;

create or replace function public.admin_schedule_follow_up(p_lead uuid, p_at timestamptz) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update leads set next_follow_up_at = p_at where id = p_lead;
end
$$;

create or replace function public.admin_register_proposal(p_lead uuid, p_value numeric, p_sent_at timestamptz, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform require_admin();
  if p_value is null or p_value < 0 or p_sent_at is null then
    raise exception 'informe valor e data da proposta' using errcode = '22023';
  end if;
  insert into proposals (lead_id, value, sent_at, note) values (p_lead, p_value, p_sent_at, p_note) returning id into v_id;
  update leads set proposal_value = p_value, proposal_sent_at = p_sent_at where id = p_lead;
  if (select stage from leads where id = p_lead) in ('novo', 'contatado', 'respondeu', 'interessado') then
    perform set_stage(p_lead, 'proposta_enviada', p_note, 'manual');
  end if;
  return v_id;
end
$$;

create or replace function public.admin_register_closing(p_lead uuid, p_value numeric, p_closed_at timestamptz, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  if p_value is null or p_value < 0 or p_closed_at is null then
    raise exception 'informe valor e data do fechamento' using errcode = '22023';
  end if;
  perform set_config('app.stage_source', 'manual', true);
  perform set_config('app.stage_note', coalesce(p_note, ''), true);
  update leads set closed_value = p_value, closed_at = p_closed_at, stage = 'fechado', loss_reason = null where id = p_lead;
  perform set_config('app.stage_source', '', true);
  perform set_config('app.stage_note', '', true);
end
$$;

-- Ações em lote: só mudam dados internos (etapa, prioridade, retorno).
create or replace function public.admin_bulk_update(p_leads uuid[], p_action text, p_value text) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid;
  n integer := 0;
begin
  perform require_admin();
  if cardinality(p_leads) > 500 then
    raise exception 'no máximo 500 leads por vez' using errcode = '22023';
  end if;
  foreach v_lead in array p_leads loop
    if p_action = 'priority' then
      update leads set priority = p_value::lead_priority where id = v_lead;
    elsif p_action = 'follow_up' then
      update leads set next_follow_up_at = nullif(p_value, '')::timestamptz where id = v_lead;
    elsif p_action = 'stage' then
      if p_value in ('fechado', 'sem_interesse', 'desqualificado') then
        raise exception 'essa etapa exige dados individuais (valor ou motivo)' using errcode = '22023';
      end if;
      perform set_stage(v_lead, p_value::lead_stage, 'alteração em lote', 'lote');
    else
      raise exception 'ação inválida' using errcode = '22023';
    end if;
    n := n + 1;
  end loop;
  return n;
end
$$;

-- Resolução da fila de possíveis duplicados.
--   criar_novo: cria a ficha (as restrições fortes continuam valendo);
--   vincular:   acrescenta as evidências a uma ficha existente;
--   descartar:  encerra sem gravar.
create or replace function public.admin_resolve_review(
  p_review uuid, p_action text, p_lead uuid default null, p_overrides jsonb default '{}', p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r duplicate_reviews;
  v_result jsonb;
  v_lead uuid;
begin
  perform require_admin();
  select * into r from duplicate_reviews where id = p_review for update;
  if not found or r.status <> 'pendente' then
    raise exception 'revisão inexistente ou já resolvida' using errcode = '22023';
  end if;
  if p_action = 'criar_novo' then
    v_result := register_candidate(r.candidate || coalesce(p_overrides, '{}'), r.origin, null, false, true);
    if v_result ->> 'status' <> 'criado' then
      return v_result;
    end if;
    v_lead := (v_result ->> 'lead_id')::uuid;
    update duplicate_reviews set status = 'criado_novo', resolution_lead_id = v_lead, resolution_note = p_note,
      resolved_by = auth.uid(), resolved_at = now() where id = p_review;
  elsif p_action = 'vincular' then
    if p_lead is null or not exists (select 1 from leads where id = p_lead) then
      raise exception 'informe o lead para vincular' using errcode = '22023';
    end if;
    perform insert_evidences(p_lead, r.candidate, r.run_id);
    update duplicate_reviews set status = 'vinculado', resolution_lead_id = p_lead, resolution_note = p_note,
      resolved_by = auth.uid(), resolved_at = now() where id = p_review;
    v_lead := p_lead;
  elsif p_action = 'descartar' then
    update duplicate_reviews set status = 'descartado', resolution_note = p_note,
      resolved_by = auth.uid(), resolved_at = now() where id = p_review;
  else
    raise exception 'ação inválida' using errcode = '22023';
  end if;
  return jsonb_build_object('status', 'resolvida', 'action', p_action, 'lead_id', v_lead);
end
$$;

-- Importação de planilha. Cada linha já chega mapeada pelo painel:
-- campos do lead + contacted ('sim' | 'nao' | null) + notes + disqualify_reason.
-- Com p_dry_run = true nada é gravado: devolve a prévia por linha.
create or replace function public.admin_import_rows(p_rows jsonb, p_dry_run boolean) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  row_data jsonb;
  idx integer := 0;
  res jsonb;
  results jsonb := '[]';
  errs text[];
  m jsonb;
  v_lead uuid;
  v_status text;
  counts jsonb := '{"criado":0,"existente":0,"possivel_duplicado":0,"invalido":0}';
begin
  perform require_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'envie até 5000 linhas por vez' using errcode = '22023';
  end if;
  for row_data in select * from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    if p_dry_run then
      errs := validate_candidate(row_data, false);
      if cardinality(errs) > 0 then
        res := jsonb_build_object('status', 'invalido', 'errors', to_jsonb(errs));
      else
        m := find_lead_matches(row_data);
        res := jsonb_build_object(
          'status', case m ->> 'decision' when 'existente' then 'existente' when 'revisao' then 'possivel_duplicado' else 'criado' end,
          'lead_id', m -> 'lead_id', 'reason', m -> 'reason', 'matched_on', m -> 'matched_on');
      end if;
    else
      res := register_candidate(row_data, 'importacao', null, false, false);
      v_status := res ->> 'status';
      v_lead := (res ->> 'lead_id')::uuid;
      if v_status in ('criado', 'existente') then
        -- "Sim" vira contato com data desconhecida, uma única vez por ficha.
        if lower(coalesce(row_data ->> 'contacted', '')) = 'sim'
           and not exists (select 1 from contact_events where lead_id = v_lead) then
          insert into contact_events (lead_id, occurred_at, channel, note, source, created_by)
          values (v_lead, null, 'outro', 'importado da planilha (data não informada)', 'importacao', auth.uid());
          if (select stage from leads where id = v_lead) = 'novo' then
            perform set_stage(v_lead, 'contatado', 'importação', 'importacao');
          end if;
        end if;
        if v_status = 'criado' and nullif(btrim(row_data ->> 'notes'), '') is not null then
          insert into lead_notes (lead_id, body, source, created_by)
          values (v_lead, left(row_data ->> 'notes', 5000), 'importacao', auth.uid());
        end if;
        if v_status = 'criado' and nullif(btrim(row_data ->> 'disqualify_reason'), '') is not null then
          update leads set loss_reason = row_data ->> 'disqualify_reason' where id = v_lead;
          perform set_stage(v_lead, 'desqualificado', 'importação', 'importacao');
        end if;
      end if;
    end if;
    counts := jsonb_set(counts, array[res ->> 'status'], to_jsonb((counts ->> (res ->> 'status'))::int + 1));
    results := results || jsonb_build_array(res || jsonb_build_object('row', idx));
  end loop;
  return jsonb_build_object('dry_run', p_dry_run, 'counts', counts, 'rows', results);
end
$$;

-- Tokens da integração: o valor aparece uma única vez, na criação.
create or replace function public.admin_create_integration_token(p_name text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := 'mkt_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
begin
  perform require_admin();
  if nullif(btrim(p_name), '') is null then
    raise exception 'informe um nome para o token' using errcode = '22023';
  end if;
  insert into integration_tokens (name, token_hash, token_prefix)
  values (btrim(p_name), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), left(v_token, 10))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end
$$;

create or replace function public.admin_revoke_integration_token(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update integration_tokens set revoked_at = now() where id = p_id and revoked_at is null;
end
$$;

create or replace function public.admin_update_settings(p jsonb) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update prospecting_settings set
    daily_target = coalesce((p ->> 'daily_target')::int, daily_target),
    cities = case when jsonb_typeof(p -> 'cities') = 'array' then array(select jsonb_array_elements_text(p -> 'cities')) else cities end,
    niches = case when jsonb_typeof(p -> 'niches') = 'array' then array(select jsonb_array_elements_text(p -> 'niches')) else niches end,
    max_run_minutes = coalesce((p ->> 'max_run_minutes')::int, max_run_minutes),
    max_searches = coalesce((p ->> 'max_searches')::int, max_searches),
    max_cost_usd = coalesce((p ->> 'max_cost_usd')::numeric, max_cost_usd),
    routine_enabled = coalesce((p ->> 'routine_enabled')::boolean, routine_enabled),
    updated_at = now()
  where id = 1;
end
$$;
