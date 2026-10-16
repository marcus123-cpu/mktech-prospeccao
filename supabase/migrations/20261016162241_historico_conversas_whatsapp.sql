-- Historical context is isolated from live reply tables and their automation triggers.
create table public.whatsapp_history (
  external_id text primary key check(length(external_id) between 1 and 200),
  lead_id uuid not null references public.leads(id) on delete cascade,
  occurred_at timestamptz not null,
  direction text not null check(direction in ('entrada','saida')),
  body text check(length(body)<=4000),
  media text not null check(media in ('texto','audio','imagem','outro'))
);
create index whatsapp_history_lead_time on public.whatsapp_history(lead_id,occurred_at desc);
alter table public.whatsapp_history enable row level security;
revoke all on public.whatsapp_history from public,anon,authenticated;
grant select on public.whatsapp_history to authenticated;
grant all on public.whatsapp_history to service_role;
create policy admin_history on public.whatsapp_history for select to authenticated using(public.is_admin());

-- Service-only function; the HTTP endpoint authenticates envio:operar first.
grant execute on function public.outreach_phone_variants(text) to service_role;
grant execute on function public.norm_phone(text) to service_role;
create function public.api_conversation_history(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_lead uuid; v_count integer;
begin
  select id into v_lead from public.leads
  where phone_e164=any(public.outreach_phone_variants(p->>'telefone')) order by created_at,id limit 1;
  if v_lead is null then return jsonb_build_object('status','ignorada'); end if;
  insert into public.whatsapp_history(external_id,lead_id,occurred_at,direction,body,media)
  values(p->>'message_id',v_lead,(p->>'ocorrida_em')::timestamptz,p->>'direcao',p->>'texto',p->>'tipo')
  on conflict do nothing;
  get diagnostics v_count=row_count;
  return jsonb_build_object('status',case when v_count=0 then 'existente' else 'registrada' end);
end $$;
revoke execute on function public.api_conversation_history(jsonb) from public,anon,authenticated;
grant execute on function public.api_conversation_history(jsonb) to service_role;

create or replace view public.conversation_timeline with (security_invoker=true) as
select id::text||':saudacao' as id,lead_id,greeting_sent_at as occurred_at,'saida'::text as direction,'saudacao'::text as source,greeting as body,'texto'::text as media from outreach_messages where greeting_sent_at is not null
union all select id::text||':mensagem',lead_id,sent_at,'saida','abordagem',body,'texto' from outreach_messages where sent_at is not null
union all select id::text||':secretario',lead_id,sent_at,'saida','secretario',body,'texto' from outreach_secretary where status='enviada'
union all select id::text||':lembrete',lead_id,sent_at,'saida','lembrete',body,'texto' from outreach_followups where status='enviado'
union all select id::text||':cliente',lead_id,received_at,'entrada',kind,body,media from outreach_replies
union all select id::text||':manual',lead_id,sent_at,'saida','manual',body,media from outreach_outbound
union all select b.id::text||':v4',b.lead_id,b.sent_at,'saida',case when b.simulated then 'simulacao' else 'hermes_v4' end,b.body,case when b.kind='video' or (b.kind='demo' and (select config->>'kind' from commercial_demonstrations where id=b.demonstration_id)='video') then 'video' else 'texto' end from commercial_outbox b where b.sent_at is not null
union all select h.external_id||':historico',h.lead_id,h.occurred_at,h.direction,
case when h.direction='saida' then 'historico_saida' else 'historico_entrada' end,h.body,h.media
from public.whatsapp_history h
where not exists(select 1 from public.outreach_replies r where r.external_id=h.external_id)
and not exists(select 1 from public.outreach_outbound o where o.external_id=h.external_id)
and not exists(select 1 from public.commercial_outbox c where c.provider_id=h.external_id);

create or replace view public.conversation_inbox with (security_invoker=true) as
select l.id,l.business_name,l.city,l.stage,l.phone_e164,l.fit_score,l.secretary_handoff_at,l.secretary_handoff_reason,l.do_not_contact,
  r.received_at as last_in_at,r.body as last_in_body,r.media as last_in_media,
  greatest(m.sent_at,m.greeting_sent_at,sr.sent_at,fu.sent_at,manual.sent_at,v4.sent_at) as last_out_at,
  coalesce(pending.status,case q.status when 'enfileirada' then 'pronta' when 'enviando' then 'enviando' when 'falhou' then 'falhou' when 'desconhecido' then 'desconhecido' end) as pending_status,
  coalesce(pending.body,q.body) as pending_body,
  (not l.do_not_contact and l.stage not in ('fechado','sem_interesse','desqualificado') and l.secretary_handoff_at is null
   and pending.status is null and q.status is null and r.received_at is not null and r.received_at>coalesce(greatest(m.sent_at,m.greeting_sent_at,sr.sent_at,fu.sent_at,manual.sent_at,v4.sent_at),'-infinity'::timestamptz)) as needs_reply,
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
