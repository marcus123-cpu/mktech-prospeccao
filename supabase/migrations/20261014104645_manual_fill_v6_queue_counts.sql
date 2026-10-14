create or replace function public.admin_commercial_fill_queue() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare candidate record; total integer:=0; checked integer:=0; added integer:=0; ready integer:=0;
begin
  perform public.require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  if (select engine_version from public.commercial_settings where id=1)<>'v6' then
    raise exception 'O motor V6 precisa estar ativo.' using errcode='22023';
  end if;
  select count(*) into total from public.leads
    where stage='novo' and not contacted and not do_not_contact;
  for candidate in
    select l.id, c.eligible from public.leads l
      join public.commercial_leads c on c.lead_id=l.id
    where l.stage='novo' and not l.contacted and not l.do_not_contact
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
  return jsonb_build_object('uncontacted',total,'checked',checked,'added',added,'already_ready',ready);
end $$;
