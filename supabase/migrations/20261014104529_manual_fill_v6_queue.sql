-- Reaproveita a mesma validação do cadastro diário e preserva exclusões manuais.
create or replace function public.commercial_v6_enqueue_verified(p_lead uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare l public.leads; d public.lead_diagnoses; digits text; evidence_domains integer;
begin
  if (select engine_version from public.commercial_settings where id=1) <> 'v6' then return false; end if;
  select * into l from public.leads where id=p_lead;
  if l.id is null or l.stage <> 'novo' or l.contacted or l.do_not_contact or l.phone_e164 is null then return false; end if;
  if exists (select 1 from public.commercial_leads where lead_id=p_lead and eligibility_reason='Retirado da fila pelo administrador') then return false; end if;
  if exists (select 1 from public.commercial_outbox where lead_id=p_lead and status<>'cancelada')
    or exists (select 1 from public.outreach_messages where lead_id=p_lead and status<>'cancelada') then return false; end if;
  select * into d from public.lead_diagnoses where lead_id=p_lead order by created_at desc,id desc limit 1;
  if d.id is null or d.fit_score < 60 or d.confidence not in ('alta','media') then return false; end if;
  if l.whatsapp_url is null or l.whatsapp_url !~* '^https://(wa\.me/|api\.whatsapp\.com/send\?phone=)' then return false; end if;
  digits:=regexp_replace(split_part(l.whatsapp_url,'?',1),'[^0-9]','','g');
  if l.whatsapp_url ~* 'api\.whatsapp\.com/send\?phone=' then
    digits:=regexp_replace(substring(l.whatsapp_url from 'phone=([0-9]+)'),'[^0-9]','','g');
  end if;
  if right(digits,11) <> right(regexp_replace(l.phone_e164,'[^0-9]','','g'),11) then return false; end if;
  select count(distinct lower(substring(e.url from '^https?://([^/]+)'))) into evidence_domains
  from public.lead_evidences e where e.lead_id=p_lead and e.url is not null
    and e.observed_at is not null and e.limitation is null;
  if evidence_domains < 2 then return false; end if;
  if not exists (
    select 1 from unnest(l.services) s join public.lead_evidences e
      on e.lead_id=p_lead and e.url is not null and e.observed_at is not null and e.limitation is null
      and position(lower(s) in lower(e.summary))>0
  ) then return false; end if;
  if not exists (
    select 1 from jsonb_array_elements(d.pains) p join public.lead_evidences e
      on e.lead_id=p_lead and e.url is not null and e.observed_at is not null and e.limitation is null
      and length(p->>'evidence')>=16 and position(lower(p->>'evidence') in lower(e.summary))>0
  ) then return false; end if;
  update public.commercial_leads set eligible=true,
    eligibility_reason='Prospecção B2B autorizada pelo operador; WhatsApp comercial público confere com telefone, duas fontes independentes e diagnóstico V6 sustentado.'
    where lead_id=p_lead and not eligible;
  return true;
end $$;

-- O botão abastece a preparação. O worker V6 ainda decide a prontidão e cria a saudação.
create function public.admin_commercial_fill_queue() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare candidate record; checked integer:=0; added integer:=0; ready integer:=0;
begin
  perform public.require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  if (select engine_version from public.commercial_settings where id=1)<>'v6' then
    raise exception 'O motor V6 precisa estar ativo.' using errcode='22023';
  end if;
  for candidate in
    select l.id, c.eligible from public.leads l
      join public.commercial_leads c on c.lead_id=l.id
    where l.stage='novo' and not l.contacted and not l.do_not_contact
      and l.phone_e164 is not null and l.whatsapp_url is not null
      and c.stage in ('NOVO','PESQUISADO','QUALIFICADO','PRONTO_PARA_CONTATO')
      and c.eligibility_reason is distinct from 'Retirado da fila pelo administrador'
      and not exists (select 1 from public.commercial_outbox b where b.lead_id=l.id and b.status<>'cancelada')
      and not exists (select 1 from public.outreach_messages b where b.lead_id=l.id and b.status<>'cancelada')
    order by l.created_at,l.id
  loop
    checked:=checked+1;
    if public.commercial_v6_enqueue_verified(candidate.id) then
      if candidate.eligible then ready:=ready+1; else added:=added+1; end if;
    end if;
  end loop;
  return jsonb_build_object('checked',checked,'added',added,'already_ready',ready);
end $$;

revoke execute on function public.admin_commercial_fill_queue() from public,anon,service_role;
grant execute on function public.admin_commercial_fill_queue() to authenticated;
