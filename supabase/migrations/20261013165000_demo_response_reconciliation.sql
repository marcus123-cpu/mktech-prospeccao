-- Confirmação pode chegar após a entrada do cliente (reconexão/ACK atrasado).
-- Preserva também a última entrada humana desde a reserva, sem presumir que assistiu.
create or replace function public.api_commercial_result(p_token uuid,p_id uuid,p_status text,p_provider text,p_error text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; b commercial_outbox; latest outreach_replies;
begin
 r:=api_commercial_result_core(p_token,p_id,p_status,p_provider,p_error);
 select * into b from commercial_outbox where id=p_id;
 if r->>'status' in ('registrado','existente') and b.sent_at is not null and b.demonstration_id is not null then
  if b.kind='demo' then
   update lead_demonstrations set sent_at=coalesce(sent_at,b.sent_at) where lead_id=b.lead_id and demonstration_id=b.demonstration_id;
   select * into latest from outreach_replies where lead_id=b.lead_id and kind='humana' and received_at>=coalesce(b.claimed_at,b.sent_at) order by received_at desc,id desc limit 1;
   if latest.id is not null then
    update lead_demonstrations set client_response=latest.body,response_at=latest.received_at where lead_id=b.lead_id and demonstration_id=b.demonstration_id and (response_at is null or response_at<latest.received_at);
   end if;
   if (select config->>'kind' from commercial_demonstrations where id=b.demonstration_id)='video' then
    update commercial_leads set video_sent_at=coalesce(video_sent_at,b.sent_at),stage=case when stage='APRESENTACAO_AUTORIZADA' then 'VIDEO_ENVIADO' else stage end where lead_id=b.lead_id;
   end if;
  else update lead_demonstrations set offered_at=coalesce(offered_at,b.sent_at) where lead_id=b.lead_id and demonstration_id=b.demonstration_id; end if;
 end if;
 return r;
end $$;
revoke execute on function public.api_commercial_result(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.api_commercial_result(uuid,uuid,text,text,text) to service_role;
