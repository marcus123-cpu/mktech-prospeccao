-- V6 intake kind is provisional: visibility must follow message timestamps.
create or replace view public.conversation_inbox with (security_invoker=true) as
select l.id,l.business_name,l.city,l.stage,l.phone_e164,l.fit_score,l.secretary_handoff_at,l.secretary_handoff_reason,l.do_not_contact,
  r.received_at as last_in_at,r.body as last_in_body,r.media as last_in_media,
  greatest(m.sent_at,m.greeting_sent_at,sr.sent_at,fu.sent_at,manual.sent_at,v4.sent_at) as last_out_at,
  coalesce(pending.status,case q.status when 'enfileirada' then 'pronta' when 'enviando' then 'enviando' when 'falhou' then 'falhou' when 'desconhecido' then 'desconhecido' end) as pending_status,
  coalesce(pending.body,q.body) as pending_body,
  (not l.do_not_contact and l.stage not in ('fechado','sem_interesse','desqualificado')
   and r.received_at is not null and r.received_at>coalesce(greatest(m.sent_at,m.greeting_sent_at,sr.sent_at,fu.sent_at,manual.sent_at,v4.sent_at),'-infinity'::timestamptz)) as needs_reply,
  greatest(r.received_at,m.sent_at,m.greeting_sent_at,sr.sent_at,fu.sent_at,manual.sent_at,v4.sent_at,l.secretary_handoff_at,l.created_at) as activity_at,
  human.sent_at as last_human_out_at,
  latest.body as last_message_body,latest.direction as last_message_direction,latest.media as last_message_media
from leads l
left join lateral(select received_at,body,media from (select received_at,body,media,id::text as id from outreach_replies where lead_id=l.id union all select occurred_at,body,media,external_id from whatsapp_history where lead_id=l.id and direction='entrada') incoming order by received_at desc,id desc limit 1) r on true
left join lateral(select sent_at,greeting_sent_at from outreach_messages where lead_id=l.id order by greatest(sent_at,greeting_sent_at) desc nulls last limit 1) m on true
left join lateral(select sent_at from outreach_secretary where lead_id=l.id and status='enviada' order by sent_at desc limit 1) sr on true
left join lateral(select sent_at from outreach_followups where lead_id=l.id and status='enviado' order by sent_at desc limit 1) fu on true
left join lateral(select sent_at from (select sent_at from outreach_outbound where lead_id=l.id union all select sent_at from manual_outbox where lead_id=l.id and status='enviada' union all select occurred_at from whatsapp_history where lead_id=l.id and direction='saida') outgoing order by sent_at desc limit 1) manual on true
left join lateral(select sent_at from commercial_outbox where lead_id=l.id and sent_at is not null order by sent_at desc limit 1) v4 on true
left join lateral(select status,body from outreach_secretary where lead_id=l.id and status in ('pronta','enviando','falhou') order by created_at desc limit 1) pending on true
left join lateral(select status,body from commercial_outbox where lead_id=l.id and status in ('enfileirada','enviando','falhou','desconhecido') order by created_at desc limit 1) q on true
left join lateral(select max(sent_at) as sent_at from (select sent_at from outreach_outbound where lead_id=l.id union all select sent_at from manual_outbox where lead_id=l.id and status='enviada') human_messages) human on true
left join lateral(select body,direction,media from conversation_timeline where lead_id=l.id and source not in ('painel_pendente','painel_falhou','simulacao') order by occurred_at desc,id desc limit 1) latest on true
where r.received_at is not null or l.secretary_handoff_at is not null or exists(select 1 from whatsapp_history where lead_id=l.id);

create or replace view public.conversation_unread with (security_invoker=true) as
 select c.id,c.business_name,c.last_in_at,c.last_in_body,c.last_in_media
 from public.conversation_inbox c left join public.conversation_reads r on r.lead_id=c.id and r.user_id=(select auth.uid())
 where c.last_in_at is not null and c.last_in_at>coalesce(c.last_human_out_at,'-infinity'::timestamptz) and (r.seen_at is null or c.last_in_at>r.seen_at);
