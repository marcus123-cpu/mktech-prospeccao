alter table public.commercial_settings
  add column queue_min_sources integer not null default 2 check (queue_min_sources between 2 and 5),
  add column queue_min_confidence text not null default 'media' check (queue_min_confidence in ('media','alta'));

-- Os critérios editáveis são usados tanto pelo botão quanto no cadastro automático.
create or replace function public.commercial_v6_enqueue_verified(p_lead uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare l public.leads; d public.lead_diagnoses; digits text; evidence_domains integer;
declare min_score integer; min_sources integer; min_confidence text;
begin
  if (select engine_version from public.commercial_settings where id=1) <> 'v6' then return false; end if;
  select o.min_fit_score,s.queue_min_sources,s.queue_min_confidence
    into min_score,min_sources,min_confidence
    from public.outreach_settings o cross join public.commercial_settings s where o.id=1 and s.id=1;
  select * into l from public.leads where id=p_lead;
  if l.id is null or l.stage <> 'novo' or l.contacted or l.do_not_contact or l.phone_e164 is null then return false; end if;
  if exists (select 1 from public.commercial_leads where lead_id=p_lead and eligibility_reason='Retirado da fila pelo administrador') then return false; end if;
  select * into d from public.lead_diagnoses where lead_id=p_lead order by created_at desc,id desc limit 1;
  if d.id is null or d.fit_score < min_score
    or d.confidence not in ('alta','media')
    or (min_confidence='alta' and d.confidence<>'alta') then return false; end if;
  if l.whatsapp_url is null or l.whatsapp_url !~* '^https://(wa\.me/|api\.whatsapp\.com/send\?phone=)' then return false; end if;
  digits:=regexp_replace(split_part(l.whatsapp_url,'?',1),'[^0-9]','','g');
  if l.whatsapp_url ~* 'api\.whatsapp\.com/send\?phone=' then
    digits:=regexp_replace(substring(l.whatsapp_url from 'phone=([0-9]+)'),'[^0-9]','','g');
  end if;
  if right(digits,11) <> right(regexp_replace(l.phone_e164,'[^0-9]','','g'),11) then return false; end if;
  select count(distinct lower(substring(e.url from '^https?://([^/]+)'))) into evidence_domains
    from public.lead_evidences e where e.lead_id=p_lead and e.url is not null
    and e.observed_at is not null and e.limitation is null;
  if evidence_domains < min_sources then return false; end if;
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
    eligibility_reason=format('Prospecção B2B autorizada pelo operador; WhatsApp comercial público confere com telefone, %s fontes independentes e diagnóstico V6 sustentado.',min_sources)
    where lead_id=p_lead and not eligible;
  return true;
end $$;

create function public.admin_commercial_queue_criteria(p_score integer,p_sources integer,p_confidence text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare candidate record; revoked integer:=0;
begin
  perform public.require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  if p_score is null or p_score not between 0 and 100 or p_sources is null or p_sources not between 2 and 5
    or p_confidence is null or p_confidence not in ('media','alta') then
    raise exception 'Critérios inválidos.' using errcode='22023';
  end if;
  update public.outreach_settings set min_fit_score=p_score where id=1;
  update public.commercial_settings set queue_min_sources=p_sources,queue_min_confidence=p_confidence where id=1;
  -- Critério mais exigente também retira da fila uma saudação ainda pendente.
  for candidate in
    select c.lead_id from public.commercial_leads c join public.leads l on l.id=c.lead_id
    where c.eligible and c.eligibility_reason like 'Prospecção B2B autorizada pelo operador;%'
      and not l.contacted and l.stage='novo'
  loop
    if not public.commercial_v6_enqueue_verified(candidate.lead_id) then
      update public.commercial_leads set eligible=false where lead_id=candidate.lead_id;
      update public.commercial_outbox set status='cancelada',error='Novos critérios de abastecimento'
        where lead_id=candidate.lead_id and kind='initial' and status='enfileirada';
      revoked:=revoked+1;
    end if;
  end loop;
  return jsonb_build_object('revoked',revoked);
end $$;

revoke execute on function public.admin_commercial_queue_criteria(integer,integer,text) from public,anon,service_role;
grant execute on function public.admin_commercial_queue_criteria(integer,integer,text) to authenticated;
