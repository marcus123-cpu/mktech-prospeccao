-- Reabre somente recusas comerciais encerradas. Não remove bloqueio de contato.
-- A reativação arma o V6 para entradas futuras; não reenvia a recusa antiga.
create function public.admin_commercial_reopen_conversation(p_lead uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare l leads; c commercial_leads; latest uuid;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  perform pg_advisory_xact_lock(hashtextextended('mktech-secretario',0));
  select * into l from leads where id=p_lead for update;
  select * into c from commercial_leads where lead_id=p_lead for update;
  if l.id is null or c.lead_id is null then raise exception 'Conversa comercial não encontrada' using errcode='22023'; end if;
  if l.do_not_contact or c.stage='NAO_CONTATAR' or l.stage in ('fechado','desqualificado')
     or exists(select 1 from outreach_replies r where r.lead_id=p_lead and r.opt_out)
     then raise exception 'Contato bloqueado ou encerrado definitivamente; reativação indisponível' using errcode='22023'; end if;
  if not c.eligible then raise exception 'Lead não está elegível para o atendimento automático' using errcode='22023'; end if;
  if c.stage<>'PERDIDO' and c.conversation_phase<>'CLOSED' and l.stage<>'sem_interesse'
     then raise exception 'Esta conversa não foi encerrada pelo bot' using errcode='22023'; end if;
  if exists(select 1 from commercial_outbox b where b.lead_id=p_lead and b.status in ('enfileirada','enviando','desconhecido'))
     then raise exception 'Há um envio pendente ou incerto; resolva-o antes de reativar' using errcode='22023'; end if;
  select id into latest from outreach_replies where lead_id=p_lead order by received_at desc,id desc limit 1;
  update outreach_replies set semantic_interpretation=jsonb_build_object('type','historical','reason','reactivated_by_admin')
    where lead_id=p_lead and semantic_interpretation is null;
  update leads set stage=case when stage='sem_interesse' then 'respondeu'::lead_stage else stage end,
    secretary_handoff_at=null,secretary_handoff_reason=null,secretary_returned_at=now()
    where id=p_lead;
  update commercial_leads set stage='RESPOSTA_RECEBIDA',conversation_phase='WAITING_HUMAN',
    processed_reply=latest,followup_at=null,followup_reason=null,
    lease_id=null,lease_token=null,lease_until=null,lease_context=null,retry_not_before=null,
    revision=revision+1 where lead_id=p_lead returning * into c;
  insert into commercial_decisions(lead_id,reply_id,intent,objective,reason,action,body,state)
    values(p_lead,latest,'admin_reopened','Aguardar nova mensagem do lead',
      'Administrador reativou atendimento sem enviar mensagem antiga','wait',null,to_jsonb(c));
end $$;
revoke execute on function public.admin_commercial_reopen_conversation(uuid) from public,anon,service_role;
grant execute on function public.admin_commercial_reopen_conversation(uuid) to authenticated;
