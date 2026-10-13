create or replace function public.api_commercial_result(p_token uuid,p_id uuid,p_status text,p_provider text,p_error text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; b commercial_outbox; d commercial_decisions;
begin
 r:=api_commercial_result_before_v6(p_token,p_id,p_status,p_provider,p_error);
 select * into b from commercial_outbox where id=p_id;
 select * into d from commercial_decisions where id=b.decision_id;
 if r->>'status'='registrado' and b.sent_at is not null and d.semantic_metadata is not null then
  update commercial_leads set conversation_phase=case when b.kind='initial' or d.intent='greeting_v6' then 'WAITING_FIRST_REPLY' when b.kind='demo' then 'DEMO_SENT' else conversation_phase end,
   commercial_memory=case when b.body ilike '%assistente comercial da MKTech Dev%' then jsonb_set(commercial_memory,'{introduced}','true'::jsonb) else commercial_memory end where lead_id=b.lead_id;
  if d.intent like '%WAIT_REQUEST%' and d.reply_id is not null then
   update commercial_leads set commercial_memory=jsonb_set(commercial_memory,'{wait_acknowledged}',
    coalesce(commercial_memory->'wait_acknowledged','[]')||jsonb_build_array((select lower(btrim(body)) from outreach_replies where id=d.reply_id)))
    where lead_id=b.lead_id and not (commercial_memory->'wait_acknowledged' @> jsonb_build_array((select lower(btrim(body)) from outreach_replies where id=d.reply_id)));
  end if;
 end if;
 if r->>'status'='registrado' and d.intent='handoff_v6_pending' and b.status in ('enviada','entregue','falhou','desconhecido') then
  update leads set secretary_handoff_at=now(),secretary_handoff_reason=left(d.reason,500) where id=b.lead_id and secretary_handoff_at is null;
 end if;
 return r;
end $$;