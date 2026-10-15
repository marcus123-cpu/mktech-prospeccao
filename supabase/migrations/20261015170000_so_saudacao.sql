-- Modo "só saudação": o Hermes manda apenas a primeira mensagem; toda conversa depois é sua.
-- 1) Disparar agora liga sozinho o envio (o clique é a sua autorização).
-- 2) Qualquer resposta recebida passa a conversa para você; o bot não responde mais.
create or replace function public.admin_dispatch_start(p_leads uuid[], p_list uuid, p_all boolean, p_bot boolean, p_today integer, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s commercial_settings; o outreach_settings; ids uuid[]; camp uuid; r jsonb; v_name text;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio', 0));
  select * into s from commercial_settings where id = 1;
  select * into o from outreach_settings where id = 1;
  if s.engine_version <> 'v6' then raise exception 'O motor V6 precisa estar ativo (Hermes comercial).' using errcode = '22023'; end if;
  update commercial_settings set enabled = true, channel_authorized = true where id = 1;
  update outreach_settings set enabled = true where id = 1;
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

alter table public.commercial_settings add column greeting_only boolean not null default false;
update public.commercial_settings set greeting_only = true where id = 1;

create function public.handoff_on_reply() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (select greeting_only from commercial_settings where id = 1) then return new; end if;
  update leads set secretary_handoff_at = now(), secretary_handoff_reason = 'Respondeu: a conversa é com você'
    where id = new.lead_id and secretary_handoff_at is null;
  return new;
end $$;
revoke execute on function public.handoff_on_reply() from public, anon, authenticated, service_role;
create trigger outreach_replies_handoff after insert on public.outreach_replies
  for each row execute function public.handoff_on_reply();

-- Quem já respondeu antes também passa para você.
update public.leads set secretary_handoff_at = now(), secretary_handoff_reason = 'Respondeu: a conversa é com você'
  where secretary_handoff_at is null and (select greeting_only from public.commercial_settings where id = 1) and exists (select 1 from public.outreach_replies r where r.lead_id = leads.id);
