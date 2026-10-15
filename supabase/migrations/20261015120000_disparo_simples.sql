-- Disparo simples: escolher leads, escolher "só a saudação" ou "bot conversa sozinho" e disparar.
-- Sem simulação obrigatória. Bloqueios de contato, duplicidade, telefone fixo, limites e horários continuam valendo.

alter table public.commercial_campaigns add column bot_replies boolean not null default true;

-- Fuso do destinatário pelo estado (Brasil); sem estado, horário de Brasília.
create function public.brazil_timezone(p_state text) returns text language sql immutable as $$
  select case upper(coalesce(p_state, ''))
    when 'AC' then 'America/Rio_Branco' when 'AM' then 'America/Manaus' when 'RO' then 'America/Porto_Velho'
    when 'RR' then 'America/Boa_Vista' when 'MT' then 'America/Cuiaba' when 'MS' then 'America/Campo_Grande'
    else 'America/Sao_Paulo' end
$$;

alter function public.api_commercial_v6_contexts(uuid) rename to api_commercial_v6_contexts_before_dispatch;
revoke execute on function public.api_commercial_v6_contexts_before_dispatch(uuid) from public, anon, authenticated, service_role;
create function public.api_commercial_v6_contexts(p_token uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb; x jsonb; out jsonb := '[]'; tz text;
begin
  r := api_commercial_v6_contexts_before_dispatch(p_token);
  for x in select value from jsonb_array_elements(coalesce(r -> 'contexts', '[]')) loop
    if nullif(x ->> 'recipient_timezone', '') is null then
      tz := public.brazil_timezone((select state from leads where id = (x ->> 'lead_id')::uuid));
      x := x || jsonb_build_object('recipient_timezone', tz);
      update commercial_leads set recipient_timezone = tz, lease_context = lease_context || jsonb_build_object('recipient_timezone', tz)
        where lead_id = (x ->> 'lead_id')::uuid and lease_id = (x ->> 'lease_id')::uuid;
    end if;
    out := out || jsonb_build_array(x);
  end loop;
  return case when r ? 'contexts' then r || jsonb_build_object('contexts', out) else r end;
end $$;
revoke execute on function public.api_commercial_v6_contexts(uuid) from public, anon, authenticated;
grant execute on function public.api_commercial_v6_contexts(uuid) to service_role;

-- "Só a saudação": depois que a primeira mensagem sai de verdade, a conversa passa para você.
alter function public.api_commercial_result(uuid, uuid, text, text, text) rename to api_commercial_result_before_dispatch;
revoke execute on function public.api_commercial_result_before_dispatch(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
create function public.api_commercial_result(p_token uuid, p_id uuid, p_status text, p_provider text, p_error text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb; b commercial_outbox; camp uuid;
begin
  r := api_commercial_result_before_dispatch(p_token, p_id, p_status, p_provider, p_error);
  select * into b from commercial_outbox where id = p_id;
  if b.id is not null and b.kind = 'initial' and b.sent_at is not null and not b.simulated then
    select c.id into camp from commercial_campaign_leads m join commercial_campaigns c on c.id = m.campaign_id
      where m.lead_id = b.lead_id and not c.bot_replies;
    if camp is not null then
      update leads set secretary_handoff_at = now(), secretary_handoff_reason = 'Disparo normal: a conversa é com você'
        where id = b.lead_id and secretary_handoff_at is null;
      perform commercial_campaign_log_event(camp, b.lead_id, 'conversa_com_voce', '{}');
    end if;
  end if;
  return r;
end $$;
revoke execute on function public.api_commercial_result(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.api_commercial_result(uuid, uuid, text, text, text) to service_role;

-- Leads novos que podem receber disparo (celular, nunca contatados, fora de campanha).
create function public.dispatch_available_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select l.id from leads l
  where l.stage = 'novo' and not l.contacted and not l.do_not_contact and l.phone_e164 ~ '^\+55[0-9]{2}9[0-9]{8}$'
    and not exists (select 1 from commercial_campaign_leads m where m.lead_id = l.id)
$$;
revoke execute on function public.dispatch_available_ids() from public, anon, authenticated, service_role;

create function public.admin_dispatch_available_count() returns integer language plpgsql stable security definer set search_path = public as $$
begin
  perform require_admin();
  return (select count(*)::int from public.dispatch_available_ids());
end $$;
revoke execute on function public.admin_dispatch_available_count() from public, anon, service_role;
grant execute on function public.admin_dispatch_available_count() to authenticated;

-- Um clique: cria a campanha já ativa, inclui os leads e libera o envio.
create function public.admin_dispatch_start(p_leads uuid[], p_list uuid, p_all boolean, p_bot boolean, p_today integer, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s commercial_settings; o outreach_settings; ids uuid[]; camp uuid; r jsonb; v_name text;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio', 0));
  select * into s from commercial_settings where id = 1;
  select * into o from outreach_settings where id = 1;
  if s.engine_version <> 'v6' then raise exception 'O motor V6 precisa estar ativo (Hermes comercial).' using errcode = '22023'; end if;
  if not s.enabled or not s.channel_authorized then
    raise exception 'O Hermes está desligado. Ative em "Hermes comercial" e confirme o canal antes de disparar.' using errcode = '22023';
  end if;
  if not o.enabled then raise exception 'O envio está desligado na Central de disparos. Ligue a chave de envio.' using errcode = '22023'; end if;
  if p_today is null or p_today not between 1 and 200 then raise exception 'Quantos enviar hoje: de 1 a 200.' using errcode = '22023'; end if;
  if coalesce(p_all, false) then
    select coalesce(array_agg(x), '{}') into ids from public.dispatch_available_ids() x;
  elsif p_list is not null then
    select coalesce(array_agg(lead_id), '{}') into ids from lead_list_items where list_id = p_list;
  else
    ids := coalesce(p_leads, '{}');
  end if;
  if cardinality(ids) = 0 then raise exception 'Nenhum lead escolhido.' using errcode = '22023'; end if;
  v_name := coalesce(nullif(btrim(p_name), ''), 'Disparo ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'));
  insert into commercial_campaigns(name, mode, status, bot_replies, activated_at, created_by)
    values (left(v_name, 80), 'autonomo', 'ativa', coalesce(p_bot, true), now(), auth.uid()) returning id into camp;
  perform commercial_campaign_log_event(camp, null, 'criada', jsonb_build_object('name', v_name, 'bot_replies', coalesce(p_bot, true), 'disparo', true));
  r := public.admin_campaign_add_leads(camp, ids);
  if (r ->> 'added')::int = 0 then
    raise exception 'Nenhum lead pôde receber disparo: %', coalesce((r -> 'rejected' -> 0 ->> 'reason'), 'sem motivo informado') using errcode = '22023';
  end if;
  -- A nota nunca bloqueia o envio escolhido por você; o limite de hoje é o que você digitou.
  update outreach_settings set paused = false, min_fit_score = 0, today_new_leads_target = p_today,
    today_new_leads_date = (now() at time zone 'America/Sao_Paulo')::date, updated_at = now(), updated_by = auth.uid() where id = 1;
  update commercial_settings set new_contacts_enabled = true where id = 1;
  perform commercial_campaign_log_event(camp, null, 'acao_activate', jsonb_build_object('mode', 'autonomo', 'today', p_today));
  return r || jsonb_build_object('campaign_id', camp, 'name', v_name);
end $$;
revoke execute on function public.admin_dispatch_start(uuid[], uuid, boolean, boolean, integer, text) from public, anon, service_role;
grant execute on function public.admin_dispatch_start(uuid[], uuid, boolean, boolean, integer, text) to authenticated;
