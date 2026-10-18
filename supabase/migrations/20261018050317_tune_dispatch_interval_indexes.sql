-- Respeita mínimo e máximo configurados no disparo; preserva a reserva e a idempotência.
create or replace function public.api_commercial_result_core(p_token uuid,p_id uuid,p_status text,p_provider text,p_error text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b commercial_outbox;
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into b from commercial_outbox where id=p_id for update;
  if b.id is null or p_status not in ('enviada','entregue','falhou','desconhecido') then return jsonb_build_object('status','invalido'); end if;
  if b.status in ('enviada','entregue') and p_status in ('enviada','falhou','desconhecido') then return jsonb_build_object('status','existente'); end if;
  if b.status not in ('enviando','desconhecido','enviada','entregue') then return jsonb_build_object('status','invalido'); end if;
  if b.provider_id is not null and p_provider is distinct from b.provider_id then return jsonb_build_object('status','invalido'); end if;
  if p_status in ('enviada','entregue') and nullif(p_provider,'') is null then return jsonb_build_object('status','invalido'); end if;
  update commercial_outbox set status=p_status,provider_id=coalesce(p_provider,provider_id),error=left(p_error,500),
    sent_at=case when p_status in ('enviada','entregue') then coalesce(sent_at,now()) else sent_at end,
    delivered_at=case when p_status='entregue' then coalesce(delivered_at,now()) else delivered_at end where id=p_id;
  if p_status in ('enviada','entregue') and b.sent_at is null then
    insert into contact_events(lead_id,occurred_at,channel,note,source) values(b.lead_id,now(),'whatsapp','Hermes V4: '||b.kind,'envio');
    if b.kind='initial' then
      update commercial_leads set stage='CONTATO_ENVIADO' where lead_id=b.lead_id;
      if (select stage from leads where id=b.lead_id)='novo' then perform set_stage(b.lead_id,'contatado','Hermes V4','envio'); end if;
    elsif b.kind='video' then update commercial_leads set stage='VIDEO_ENVIADO',video_sent_at=now() where lead_id=b.lead_id;
    elsif b.kind='proposal' then
      insert into proposals(lead_id,value,sent_at,note) select b.lead_id,(d.state->'facts'->>'proposta_valor')::numeric,now(),b.body from commercial_decisions d where id=b.decision_id;
      update commercial_leads set stage='PROPOSTA_ENVIADA' where lead_id=b.lead_id;
      perform set_stage(b.lead_id,'proposta_enviada','Proposta oficial enviada pelo Hermes V4','envio');
    end if;
    update outreach_settings set next_send_at=now()+make_interval(secs=>min_delay_seconds + floor(random() * (max_delay_seconds-min_delay_seconds+1))::integer) where id=1;
  end if;
  if p_status in ('falhou','desconhecido') and b.status is distinct from p_status then insert into commercial_notifications(lead_id,title,detail) values(b.lead_id,'Envio '||p_status,'Verificar integração e resultado antes de agir.'); end if;
  return jsonb_build_object('status','registrado','message_status',p_status);
end $$;
-- A migração de histórico já criou este mesmo índice.
drop index if exists public.whatsapp_history_lead_time_idx;
