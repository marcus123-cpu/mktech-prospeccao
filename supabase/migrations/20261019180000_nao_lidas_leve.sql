-- Lista de não lidas sem montar a caixa de entrada inteira: só a última mensagem recebida de cada contato.
-- Mesmas colunas e mesma regra de antes (inclui a marcação manual "não lida").
create or replace view public.conversation_unread with (security_invoker = true) as
 select l.id, l.business_name, r.received_at as last_in_at, r.body as last_in_body, r.media as last_in_media
 from public.leads l
 join lateral (
   select received_at, body, media from (
     select received_at, body, media, id::text as id from public.outreach_replies where lead_id = l.id
     union all
     select occurred_at, body, media, external_id from public.whatsapp_history where lead_id = l.id and direction = 'entrada'
   ) incoming order by received_at desc, id desc limit 1
 ) r on true
 left join public.conversation_reads cr on cr.lead_id = l.id and cr.user_id = (select auth.uid())
 where cr.seen_at is null or r.received_at > cr.seen_at or cr.marked_unread;
