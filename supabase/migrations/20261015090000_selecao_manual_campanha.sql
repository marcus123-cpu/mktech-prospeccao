-- Seleção manual em campanha: o administrador autoriza o lead; a prontidão da pesquisa é conferida
-- pelo Hermes antes da saudação (não pelos critérios da fila automática).
create or replace function public.admin_campaign_add_leads(p_campaign uuid, p_leads uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare camp commercial_campaigns; lid uuid; l leads; cl commercial_leads; added integer:=0; rejected jsonb:='[]'; rejected_total integer:=0; why text; base jsonb; mem jsonb;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into camp from commercial_campaigns where id=p_campaign for update;
  if camp.id is null then raise exception 'Campanha não encontrada.' using errcode='22023'; end if;
  if camp.status='encerrada' then raise exception 'Campanha encerrada não recebe leads.' using errcode='22023'; end if;
  for lid in select distinct x from unnest(coalesce(p_leads,'{}')) x loop
    why:=null;
    select * into l from leads where id=lid;
    select * into cl from commercial_leads where lead_id=lid for update;
    if l.id is null then why:='Lead não encontrado.';
    elsif l.do_not_contact then why:='Lead pediu para não ser contatado.';
    elsif l.phone_e164 is null then why:='Sem telefone válido.';
    elsif l.contacted or l.stage<>'novo' then why:='Lead já foi contatado ou saiu da etapa inicial.';
    elsif exists(select 1 from commercial_campaign_leads m where m.lead_id=lid) then why:='Lead já pertence a uma campanha.';
    elsif exists(select 1 from commercial_campaign_leads m join leads o on o.id=m.lead_id where o.id<>lid and o.phone_e164=any(outreach_phone_variants(l.phone_e164)))
      or exists(select 1 from leads o where o.id<>lid and o.contacted and o.phone_e164=any(outreach_phone_variants(l.phone_e164))) then why:='Telefone duplicado em outro lead já selecionado ou contatado.';
    end if;
    -- Telefone fixo não recebe WhatsApp: a campanha não tem como contatar.
    if why is null and l.phone_e164 !~ '^\+55[0-9]{2}9[0-9]{8}$' then why:='Telefone fixo ou sem WhatsApp provável.'; end if;
    -- A seleção do administrador autoriza o lead. A prontidão da pesquisa (identidade, serviços, diagnóstico
    -- e fontes) continua sendo conferida pelo Hermes antes da saudação: sem ela, ele espera e mostra o motivo.
    if why is null and not cl.eligible then
      update commercial_leads set eligible=true,
        eligibility_reason='Selecionado pelo administrador em campanha; prontidão da pesquisa conferida antes da saudação.'
        where lead_id=lid;
    end if;
    if why is null then
      select to_jsonb(c) into base from commercial_leads c where lead_id=lid;
      select to_jsonb(m) into mem from lead_conversation_memory m where lead_id=lid;
      insert into commercial_campaign_leads(lead_id,campaign_id,baseline,baseline_memory) values (lid,p_campaign,base,mem);
      added:=added+1;
      perform commercial_campaign_log_event(p_campaign,lid,'lead_adicionado','{}');
    else
      rejected_total:=rejected_total+1;
      if jsonb_array_length(rejected)<50 then rejected:=rejected||jsonb_build_array(jsonb_build_object('lead_id',lid,'reason',why)); end if;
    end if;
  end loop;
  return jsonb_build_object('added',added,'rejected',rejected,'rejected_total',rejected_total);
end $$;
