-- A pesquisa diária alimenta o motor V6 somente quando há canal comercial
-- público, duas fontes e diagnóstico com trecho verificável. A decisão final
-- de prontidão continua no motor antes de qualquer saudação.
create function public.commercial_v6_enqueue_verified(p_lead uuid) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare l public.leads; d public.lead_diagnoses; digits text; evidence_domains integer;
begin
  if (select engine_version from public.commercial_settings where id=1) <> 'v6' then return false; end if;
  select * into l from public.leads where id=p_lead;
  if l.id is null or l.stage <> 'novo' or l.contacted or l.do_not_contact or l.phone_e164 is null then return false; end if;
  select * into d from public.lead_diagnoses where lead_id=p_lead order by created_at desc,id desc limit 1;
  if d.id is null or d.fit_score < 60 or d.confidence not in ('alta','media') then return false; end if;
  -- O mesmo número precisa aparecer no link público do WhatsApp do negócio.
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

create function public.commercial_v6_enqueue_on_diagnosis() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  perform public.commercial_v6_enqueue_verified(new.lead_id);
  return new;
end $$;

create trigger commercial_v6_enqueue_on_diagnosis
after insert on public.lead_diagnoses for each row
execute function public.commercial_v6_enqueue_on_diagnosis();

revoke execute on function public.commercial_v6_enqueue_verified(uuid),
  public.commercial_v6_enqueue_on_diagnosis() from public,anon,authenticated;
grant execute on function public.commercial_v6_enqueue_verified(uuid) to service_role;
