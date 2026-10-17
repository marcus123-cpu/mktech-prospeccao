-- Read markers belong to the signed-in administrator, independently of bot replies.
create table public.conversation_reads (
 user_id uuid not null references auth.users(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,
 seen_at timestamptz not null,
 primary key(user_id,lead_id)
);
alter table public.conversation_reads enable row level security;
revoke all on public.conversation_reads from public,anon,authenticated;
grant select,insert,update on public.conversation_reads to authenticated;
grant all on public.conversation_reads to service_role;
create policy own_reads_select on public.conversation_reads for select to authenticated using(user_id=(select auth.uid()) and (select public.is_admin()));
create policy own_reads_insert on public.conversation_reads for insert to authenticated with check(user_id=(select auth.uid()) and (select public.is_admin()));
create policy own_reads_update on public.conversation_reads for update to authenticated using(user_id=(select auth.uid()) and (select public.is_admin())) with check(user_id=(select auth.uid()) and (select public.is_admin()));
create function public.mark_conversation_seen(p_lead uuid,p_seen timestamptz) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if not public.is_admin() or auth.uid() is null then raise insufficient_privilege; end if;
 -- Never mark an unseen concurrent reply as read or move the cursor backwards.
 insert into public.conversation_reads(user_id,lead_id,seen_at)
 select auth.uid(),id,least(p_seen,last_in_at,now()) from public.conversation_inbox where id=p_lead and last_in_at is not null
 on conflict(user_id,lead_id) do update set seen_at=greatest(conversation_reads.seen_at,excluded.seen_at);
end $$;
revoke execute on function public.mark_conversation_seen(uuid,timestamptz) from public,anon;
grant execute on function public.mark_conversation_seen(uuid,timestamptz) to authenticated;
create or replace view public.conversation_inbox with (security_invoker=true) as
select l.id,l.business_name,l.city,l.stage,l.phone_e164,l.fit_score,l.secretary_handoff_at,l.secretary_handoff_reason,l.do_not_contact,
  r.received_at as last_in_at,r.body as last_in_body,r.media as last_in_media,
  greatest(m.sent_at,m.greeting_sent_at,sr.sent_at,fu.sent_at,manual.sent_at,v4.sent_at) as last_out_at,
  coalesce(pending.status,case q.status when 'enfileirada' then 'pronta' when 'enviando' then 'enviando' when 'falhou' then 'falhou' when 'desconhecido' then 'desconhecido' end) as pending_status,
  coalesce(pending.body,q.body) as pending_body,
  (not l.do_not_contact and l.stage not in ('fechado','sem_interesse','desqualificado')
   and r.received_at is not null and r.received_at>coalesce(greatest(m.sent_at,m.greeting_sent_at,sr.sent_at,fu.sent_at,manual.sent_at,v4.sent_at),'-infinity'::timestamptz)) as needs_reply,
  greatest(r.received_at,m.sent_at,m.greeting_sent_at,sr.sent_at,fu.sent_at,manual.sent_at,v4.sent_at,l.secretary_handoff_at,l.created_at) as activity_at
from leads l
left join lateral(select received_at,body,media from (select received_at,body,media,id::text as id from outreach_replies where lead_id=l.id and kind='humana' union all select occurred_at,body,media,external_id from whatsapp_history where lead_id=l.id and direction='entrada') incoming order by received_at desc,id desc limit 1) r on true
left join lateral(select sent_at,greeting_sent_at from outreach_messages where lead_id=l.id order by greatest(sent_at,greeting_sent_at) desc nulls last limit 1) m on true
left join lateral(select sent_at from outreach_secretary where lead_id=l.id and status='enviada' order by sent_at desc limit 1) sr on true
left join lateral(select sent_at from outreach_followups where lead_id=l.id and status='enviado' order by sent_at desc limit 1) fu on true
left join lateral(select sent_at from (select sent_at from outreach_outbound where lead_id=l.id union all select occurred_at from whatsapp_history where lead_id=l.id and direction='saida') outgoing order by sent_at desc limit 1) manual on true
left join lateral(select sent_at from commercial_outbox where lead_id=l.id and sent_at is not null order by sent_at desc limit 1) v4 on true
left join lateral(select status,body from outreach_secretary where lead_id=l.id and status in ('pronta','enviando','falhou') order by created_at desc limit 1) pending on true
left join lateral(select status,body from commercial_outbox where lead_id=l.id and status in ('enfileirada','enviando','falhou','desconhecido') order by created_at desc limit 1) q on true
where r.received_at is not null or l.secretary_handoff_at is not null or exists(select 1 from whatsapp_history where lead_id=l.id);

create view public.conversation_unread with (security_invoker=true) as
 select c.id,c.business_name,c.last_in_at,c.last_in_body,c.last_in_media
 from public.conversation_inbox c left join public.conversation_reads r on r.lead_id=c.id and r.user_id=(select auth.uid())
 where c.last_in_at is not null and (r.seen_at is null or c.last_in_at>r.seen_at);
revoke all on public.conversation_unread from public,anon;
grant select on public.conversation_unread to authenticated;

create table public.whatsapp_receipts (
 external_id text primary key check(length(external_id) between 1 and 200),
 lead_id uuid not null references public.leads(id) on delete cascade,
 ack smallint not null check(ack between -1 and 4),
 updated_at timestamptz not null default now()
);
alter table public.whatsapp_receipts enable row level security;
revoke all on public.whatsapp_receipts from public,anon,authenticated;
grant select on public.whatsapp_receipts to authenticated;
grant all on public.whatsapp_receipts to service_role;
create policy admin_receipts on public.whatsapp_receipts for select to authenticated using((select public.is_admin()));
create or replace function public.api_conversation_history(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_lead uuid; v_count integer;
begin
  select id into v_lead from public.leads
  where phone_e164=any(public.outreach_phone_variants(p->>'telefone')) order by created_at,id limit 1;
  if v_lead is null then return jsonb_build_object('status','ignorada'); end if;
  if p->>'direcao'='saida' and p ? 'ack' then
    insert into public.whatsapp_receipts(external_id,lead_id,ack)
    values(p->>'message_id',v_lead,(p->>'ack')::smallint)
    on conflict(external_id) do update set ack=greatest(whatsapp_receipts.ack,excluded.ack),updated_at=now();
  end if;
  insert into public.whatsapp_history(external_id,lead_id,occurred_at,direction,body,media)
  values(p->>'message_id',v_lead,(p->>'ocorrida_em')::timestamptz,p->>'direcao',p->>'texto',p->>'tipo')
  on conflict do nothing;
  get diagnostics v_count=row_count;
  return jsonb_build_object('status',case when v_count=0 then 'existente' else 'registrada' end);
end $$;
revoke execute on function public.api_conversation_history(jsonb) from public,anon,authenticated;
grant execute on function public.api_conversation_history(jsonb) to service_role;

create or replace view public.conversation_timeline with (security_invoker=true) as
with events as (
select id::text||':saudacao' as id,lead_id,greeting_sent_at as occurred_at,'saida'::text as direction,'saudacao'::text as source,greeting as body,'texto'::text as media,null::text as external_id from outreach_messages where greeting_sent_at is not null
union all select id::text||':mensagem',lead_id,sent_at,'saida','abordagem',body,'texto',null from outreach_messages where sent_at is not null
union all select id::text||':secretario',lead_id,sent_at,'saida','secretario',body,'texto',null from outreach_secretary where status='enviada'
union all select id::text||':lembrete',lead_id,sent_at,'saida','lembrete',body,'texto',null from outreach_followups where status='enviado'
union all select id::text||':cliente',lead_id,received_at,'entrada',kind,body,media,external_id from outreach_replies
union all select id::text||':manual',lead_id,sent_at,'saida','manual',body,media,external_id from outreach_outbound
union all select b.id::text||':v4',b.lead_id,b.sent_at,'saida',case when b.simulated then 'simulacao' else 'hermes_v4' end,b.body,case when b.kind='video' or (b.kind='demo' and (select config->>'kind' from commercial_demonstrations where id=b.demonstration_id)='video') then 'video' else 'texto' end,b.provider_id from commercial_outbox b where b.sent_at is not null
union all select h.external_id||':historico',h.lead_id,h.occurred_at,h.direction,
case when h.direction='saida' then 'historico_saida' else 'historico_entrada' end,h.body,h.media,h.external_id
from public.whatsapp_history h
where not exists(select 1 from public.outreach_replies r where r.external_id=h.external_id)
and not exists(select 1 from public.outreach_outbound o where o.external_id=h.external_id)
and not exists(select 1 from public.commercial_outbox c where c.provider_id=h.external_id)
and not exists(select 1 from public.manual_outbox m where m.provider_id=h.external_id)
union all select m.id::text||':painel',m.lead_id,coalesce(m.sent_at,m.created_at),'saida',case m.status when 'enviada' then 'painel' when 'falhou' then 'painel_falhou' else 'painel_pendente' end,m.body,m.media,case when m.media='audio' then 'voice:'||m.id::text else null end from manual_outbox m
)
select e.*,r.ack as receipt_ack from events e
left join public.manual_outbox m on e.id=m.id::text||':painel'
left join public.whatsapp_receipts r on r.external_id=coalesce(m.provider_id,e.external_id) and r.lead_id=e.lead_id;
