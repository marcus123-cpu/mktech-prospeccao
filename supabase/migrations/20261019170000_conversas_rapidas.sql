-- Conversas rápidas: a linha do tempo de UM contato é montada com índices, em vez de varrer todas as mensagens de todos os contatos.
-- Mesmo conteúdo da view conversation_timeline, filtrado por contato dentro de cada origem.
create or replace function public.conversation_timeline_for(p_lead uuid)
returns table (id text, lead_id uuid, occurred_at timestamptz, direction text, source text, body text, media text, external_id text, receipt_ack smallint)
language sql stable security invoker set search_path = public, pg_temp as $$
  with events as (
    select m.id::text || ':saudacao' as id, m.lead_id, m.greeting_sent_at as occurred_at, 'saida'::text as direction, 'saudacao'::text as source, m.greeting as body, 'texto'::text as media, null::text as external_id
      from outreach_messages m where m.lead_id = p_lead and m.greeting_sent_at is not null
    union all
    select m.id::text || ':mensagem', m.lead_id, m.sent_at, 'saida', 'abordagem', m.body, 'texto', null
      from outreach_messages m where m.lead_id = p_lead and m.sent_at is not null
    union all
    select s.id::text || ':secretario', s.lead_id, s.sent_at, 'saida', 'secretario', s.body, 'texto', null
      from outreach_secretary s where s.lead_id = p_lead and s.status = 'enviada'
    union all
    select f.id::text || ':lembrete', f.lead_id, f.sent_at, 'saida', 'lembrete', f.body, 'texto', null
      from outreach_followups f where f.lead_id = p_lead and f.status = 'enviado'
    union all
    select r.id::text || ':cliente', r.lead_id, r.received_at, 'entrada', r.kind, r.body, r.media, r.external_id
      from outreach_replies r where r.lead_id = p_lead
    union all
    select o.id::text || ':manual', o.lead_id, o.sent_at, 'saida', 'manual', o.body, o.media, o.external_id
      from outreach_outbound o where o.lead_id = p_lead
    union all
    select b.id::text || ':v4', b.lead_id, b.sent_at, 'saida',
      case when b.simulated then 'simulacao' else 'hermes_v4' end, b.body,
      case when b.kind = 'video' or (b.kind = 'demo' and (select d.config ->> 'kind' from commercial_demonstrations d where d.id = b.demonstration_id) = 'video') then 'video' else 'texto' end,
      b.provider_id
      from commercial_outbox b where b.lead_id = p_lead and b.sent_at is not null
    union all
    select h.external_id || ':historico', h.lead_id, h.occurred_at, h.direction,
      case when h.direction = 'saida' then 'historico_saida' else 'historico_entrada' end, h.body, h.media, h.external_id
      from whatsapp_history h
      where h.lead_id = p_lead
        and not exists (select 1 from outreach_replies r where r.external_id = h.external_id)
        and not exists (select 1 from outreach_outbound o where o.external_id = h.external_id)
        and not exists (select 1 from commercial_outbox c where c.provider_id = h.external_id)
        and not exists (select 1 from manual_outbox x where x.provider_id = h.external_id)
    union all
    select x.id::text || ':painel', x.lead_id, coalesce(x.sent_at, x.created_at), 'saida',
      case x.status when 'enviada' then 'painel' when 'falhou' then 'painel_falhou' else 'painel_pendente' end,
      x.body, x.media, case when x.media = 'audio' then 'voice:' || x.id::text else null end
      from manual_outbox x where x.lead_id = p_lead
  )
  select e.id, e.lead_id, e.occurred_at, e.direction, e.source, e.body, e.media, e.external_id, rc.ack
  from events e
  left join manual_outbox mo on e.id = (mo.id::text || ':painel')
  left join whatsapp_receipts rc on rc.external_id = coalesce(mo.provider_id, e.external_id) and rc.lead_id = e.lead_id;
$$;
grant execute on function public.conversation_timeline_for(uuid) to authenticated;

-- Detalhe da conversa: usa a linha do tempo só do contato.
create or replace function public.admin_conversation_detail(p_lead uuid, p_limit integer default 300)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_limit is null or p_limit not between 1 and 300 then raise exception 'Limite inválido' using errcode = '22023'; end if;
  return (with events as materialized (
    select * from public.conversation_timeline_for(p_lead) order by occurred_at desc, id desc limit p_limit
  ) select jsonb_build_object(
    'current', (select to_jsonb(c) from public.conversation_inbox c where c.id = p_lead),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc, e.id desc) from events e), '[]'),
    'audio_ids', coalesce((select jsonb_agg(distinct a.external_id) from public.chat_audio a join events e on e.external_id = a.external_id where e.media = 'audio'), '[]')
  ));
end $$;

-- Lista de conversas: a "última mensagem" de cada contato vem da linha do tempo dele, não de uma varredura geral.
do $$
declare d text;
begin
  d := pg_get_viewdef('public.conversation_inbox'::regclass, true);
  d := regexp_replace(d, ';\s*$', '');
  d := regexp_replace(d,
    'LEFT JOIN \( SELECT DISTINCT ON \(conversation_timeline\.lead_id\).*? latest ON latest\.lead_id = l\.id',
    'LEFT JOIN LATERAL (SELECT t.body, t.direction, t.media FROM public.conversation_timeline_for(l.id) t WHERE t.source <> ALL (ARRAY[''painel_pendente''::text, ''painel_falhou''::text, ''simulacao''::text]) ORDER BY t.occurred_at DESC, t.id DESC LIMIT 1) latest ON true');
  if d like '%DISTINCT ON (conversation_timeline.lead_id)%' then raise exception 'A view conversation_inbox mudou: a troca não foi aplicada.'; end if;
  execute 'create or replace view public.conversation_inbox with (security_invoker = true) as ' || d;
end $$;
