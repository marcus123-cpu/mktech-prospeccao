-- Um cartão por lead: manter legado e incluir a fila e os resultados V4.
alter view public.outreach_funnel rename to outreach_funnel_legacy;
create view public.outreach_funnel with (security_invoker=true) as
with v4 as (
select l.id,l.business_name,l.city,l.stage,coalesce(c.score,l.fit_score) as fit_score,
  l.phone_e164,l.price_question_at,l.do_not_contact,b.status as message_status,
  initial.sent_at as greeting_sent_at,sent.last_sent_at as sent_at,b.created_at as message_created_at,
  r.received_at as last_reply_at,r.body as last_reply,r.kind as last_reply_kind,
  exists(select 1 from public.outreach_replies a where a.lead_id=l.id and a.media='audio') as sent_audio,
  case
    when l.funnel_archived_at is not null then 'arquivado'
    when l.stage='fechado' or c.stage='VENDA_FECHADA' then 'fechado'
    when l.do_not_contact or l.stage in ('sem_interesse','desqualificado') or c.stage in ('NAO_CONTATAR','PERDIDO') then 'encerrado'
    when b.status in ('falhou','desconhecido') then 'atencao'
    when l.price_question_at is not null then 'valor'
    when l.stage='proposta_enviada' or c.stage in ('PROPOSTA_SOLICITADA','PROPOSTA_ENVIADA','NEGOCIACAO') then 'fechando'
    when b.kind='initial' and b.status in ('enfileirada','enviando') then 'fila'
    when c.stage='SEM_RESPOSTA' then 'sem_resposta'
    when r.kind='humana' then 'conversa'
    when r.kind='automatica' then 'aguardando'
    when b.kind='followup' and b.sent_at is not null then 'lembrando'
    else 'enviado'
  end as coluna,
  greatest(l.updated_at,c.updated_at,b.created_at,b.claimed_at,sent.last_sent_at,r.received_at,l.funnel_archived_at) as movido_em,
  l.funnel_archived_at
from public.leads l
join public.commercial_leads c on c.lead_id=l.id
join lateral(select x.* from public.commercial_outbox x where x.lead_id=l.id
  and (x.status<>'cancelada' or l.do_not_contact or l.funnel_archived_at is not null
    or l.stage in ('sem_interesse','desqualificado','fechado') or c.stage in ('NAO_CONTATAR','PERDIDO','VENDA_FECHADA'))
  order by (x.status<>'cancelada') desc,x.created_at desc,x.id desc limit 1) b on true
left join lateral(select x.sent_at from public.commercial_outbox x join public.commercial_decisions d on d.id=x.decision_id
  where x.lead_id=l.id and x.kind='initial' and d.intent='quebra_gelo' and x.sent_at is not null
  order by x.sent_at limit 1) initial on true
left join lateral(select max(x.sent_at) as last_sent_at from public.commercial_outbox x where x.lead_id=l.id) sent on true
left join lateral(select x.* from public.outreach_replies x where x.lead_id=l.id
  order by (x.kind='humana') desc,x.received_at desc,x.id desc limit 1) r on true
)
select legacy.* from public.outreach_funnel_legacy legacy
where not exists(select 1 from v4 where v4.id=legacy.id)
union all select * from v4;
revoke all on public.outreach_funnel from public,anon;
grant select on public.outreach_funnel to authenticated,service_role;
