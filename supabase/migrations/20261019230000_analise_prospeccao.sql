-- Análise da prospecção: onde os clientes param de responder e quanto tempo você demora para responder.
-- Coorte = leads cujo primeiro quebra-gelo saiu no período. Contatos que vieram do WhatsApp (atendimento manual) ficam de fora.
create or replace function public.analysis_core(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare out jsonb;
begin
  create temporary table if not exists _an_ev (lead_id uuid, ts timestamptz, dir text) on commit drop;
  truncate _an_ev;
  -- Mensagens RECEBIDAS de pessoas (resposta automática do WhatsApp Business não conta como resposta).
  insert into _an_ev
    select lead_id, received_at, 'in' from outreach_replies where kind = 'humana'
    union all
    select h.lead_id, h.occurred_at, 'in' from whatsapp_history h
      where h.direction = 'entrada' and not exists (select 1 from outreach_replies r where r.external_id = h.external_id)
    union all
    select lead_id, received_at, 'auto' from outreach_replies where kind = 'automatica';
  -- Mensagens ENVIADAS (menos o quebra-gelo, que vem da tabela de saudações).
  insert into _an_ev
    select lead_id, sent_at, 'out' from commercial_outbox where sent_at is not null and not simulated and kind <> 'initial'
    union all select lead_id, sent_at, 'out' from outreach_messages where sent_at is not null
    union all select lead_id, sent_at, 'out' from outreach_secretary where status = 'enviada' and sent_at is not null
    union all select lead_id, sent_at, 'out' from outreach_followups where status = 'enviado' and sent_at is not null
    union all select lead_id, sent_at, 'out' from outreach_outbound where sent_at is not null
    union all select lead_id, coalesce(sent_at, created_at), 'out' from manual_outbox where status = 'enviada'
    union all
    select h.lead_id, h.occurred_at, 'out' from whatsapp_history h
      where h.direction = 'saida'
        and not exists (select 1 from outreach_outbound o where o.external_id = h.external_id)
        and not exists (select 1 from commercial_outbox c where c.provider_id = h.external_id)
        and not exists (select 1 from manual_outbox m where m.provider_id = h.external_id);
  create index on _an_ev (lead_id, ts);

  with greet as (
    select lead_id, min(ts) g1 from (
      select lead_id, sent_at ts from commercial_outbox where kind = 'initial' and sent_at is not null and not simulated
      union all select lead_id, greeting_sent_at from outreach_messages where greeting_sent_at is not null
    ) x group by lead_id
  ),
  coorte as (
    select g.lead_id, g.g1, l.business_name, l.niche, l.stage, l.do_not_contact, l.proposal_sent_at,
           cl.strategy::text as estrategia, om.style as estilo
    from greet g
    join leads l on l.id = g.lead_id and l.source_name is distinct from 'WhatsApp'
    left join commercial_leads cl on cl.lead_id = g.lead_id
    left join lateral (select style from outreach_messages where lead_id = g.lead_id order by created_at limit 1) om on true
    where g.g1 >= p_from and g.g1 < p_to
  ),
  lead_ev as (
    select c.*,
      (select min(ts) from _an_ev e where e.lead_id = c.lead_id and e.dir = 'in' and e.ts > c.g1) as r1,
      exists (select 1 from _an_ev e where e.lead_id = c.lead_id and e.dir = 'auto' and e.ts > c.g1) as auto1,
      (select max(ts) from _an_ev e where e.lead_id = c.lead_id and e.dir = 'in') as ult_in,
      (select max(ts) from _an_ev e where e.lead_id = c.lead_id and e.dir = 'out') as ult_out
    from coorte c
  ),
  lead_p as (
    select le.*,
      (select min(ts) from _an_ev e where e.lead_id = le.lead_id and e.dir = 'out' and le.r1 is not null and e.ts > le.r1) as p1
    from lead_ev le
  ),
  lead_f as (
    select lp.*,
      (select min(ts) from _an_ev e where e.lead_id = lp.lead_id and e.dir = 'in' and lp.p1 is not null and e.ts > lp.p1) as r2
    from lead_p lp
  ),
  estado as (
    select lf.*,
      case
        when lf.stage = 'fechado' then 'fechado'
        when lf.stage = 'proposta_enviada' or lf.proposal_sent_at is not null then 'proposta'
        when lf.do_not_contact or lf.stage in ('sem_interesse', 'desqualificado') then 'recusou'
        when lf.ult_in is not null and lf.ult_in > coalesce(lf.ult_out, lf.g1) and lf.r1 is not null then 'aguardando_voce'
        when lf.r1 is null and lf.g1 < now() - interval '48 hours' and lf.auto1 then 'sem_resposta_so_automatica'
        when lf.r1 is null and lf.g1 < now() - interval '48 hours' then 'sem_resposta_silencio'
        when lf.r1 is null then 'aguardando_cliente_recente'
        when lf.p1 is null then 'respondeu_sem_apresentacao'
        when lf.r2 is null and lf.p1 < now() - interval '48 hours' then 'parou_apos_apresentacao'
        when lf.r2 is null then 'aguardando_cliente_apresentacao'
        when coalesce(lf.ult_out, lf.g1) > coalesce(lf.ult_in, lf.g1) and coalesce(lf.ult_out, lf.g1) < now() - interval '72 hours' then 'esfriou_na_conversa'
        else 'em_andamento'
      end as situacao
    from lead_f lf
  ),
  resp as ( -- tempo para VOCÊ responder: cada vez que o cliente escreveu e a conversa estava com você
    select i.lead_id, i.ts,
           (select min(o.ts) from _an_ev o where o.lead_id = i.lead_id and o.dir = 'out' and o.ts > i.ts) as resposta
    from _an_ev i
    where i.dir = 'in' and i.ts >= p_from and i.ts < p_to
      and exists (select 1 from greet g join leads l on l.id = g.lead_id and l.source_name is distinct from 'WhatsApp' where g.lead_id = i.lead_id and g.g1 < i.ts)
      and not exists (select 1 from _an_ev i2 where i2.lead_id = i.lead_id and i2.dir = 'in' and i2.ts < i.ts
                      and i2.ts > coalesce((select max(o.ts) from _an_ev o where o.lead_id = i.lead_id and o.dir = 'out' and o.ts < i.ts), '-infinity'))
  ),
  tempos as (
    select extract(epoch from (resposta - ts)) / 60.0 as minutos from resp where resposta is not null
  )
  select jsonb_build_object(
    'funil', (select jsonb_build_object(
        'quebra_gelo', count(*),
        'so_automatica', count(*) filter (where r1 is null and auto1),
        'responderam', count(r1),
        'apresentacao', count(p1),
        'responderam_apresentacao', count(r2),
        'proposta', count(*) filter (where situacao in ('proposta', 'fechado')),
        'fechado', count(*) filter (where situacao = 'fechado'),
        'recusou', count(*) filter (where situacao = 'recusou')) from estado),
    'situacoes', (select coalesce(jsonb_object_agg(situacao, n), '{}') from (select situacao, count(*) n from estado group by 1) s),
    'exemplos', (select coalesce(jsonb_object_agg(situacao, ex), '{}') from (
        select situacao, jsonb_agg(jsonb_build_object('id', lead_id, 'nome', business_name, 'desde', ref) order by ref) ex
        from (select situacao, lead_id, business_name,
                     case situacao when 'aguardando_voce' then ult_in when 'parou_apos_apresentacao' then p1 when 'esfriou_na_conversa' then ult_out else g1 end ref,
                     row_number() over (partition by situacao order by case situacao when 'aguardando_voce' then ult_in when 'parou_apos_apresentacao' then p1 when 'esfriou_na_conversa' then ult_out else g1 end) rn
              from estado where situacao in ('aguardando_voce', 'parou_apos_apresentacao', 'esfriou_na_conversa', 'respondeu_sem_apresentacao')) z
        where rn <= 8 group by situacao) q),
    'tempo_cliente_quebra_gelo', (select jsonb_build_object(
        'mediana_min', round((percentile_cont(0.5) within group (order by extract(epoch from (r1 - g1)) / 60.0))::numeric, 0),
        'n', count(*)) from estado where r1 is not null),
    'tempo_voce', (select jsonb_build_object(
        'respondidas', count(*) filter (where minutos is not null),
        'mediana_min', round((percentile_cont(0.5) within group (order by minutos))::numeric, 0),
        'p90_min', round((percentile_cont(0.9) within group (order by minutos))::numeric, 0),
        'ate_5min', count(*) filter (where minutos <= 5), 'ate_1h', count(*) filter (where minutos <= 60), 'ate_24h', count(*) filter (where minutos <= 1440),
        'mais_de_24h', count(*) filter (where minutos > 1440)) from tempos),
    'sem_resposta_agora', (select jsonb_build_object('n', count(*), 'mais_antiga_horas', round((max(extract(epoch from (now() - ts)) / 3600.0))::numeric, 0)) from resp where resposta is null),
    'resposta_rapida', (select jsonb_build_object(
        'rapido_n', count(*) filter (where p1 - r1 <= interval '1 hour'),
        'rapido_continuou', count(*) filter (where p1 - r1 <= interval '1 hour' and r2 is not null),
        'lento_n', count(*) filter (where p1 - r1 > interval '1 hour'),
        'lento_continuou', count(*) filter (where p1 - r1 > interval '1 hour' and r2 is not null)) from estado where p1 is not null),
    'por_nicho', (select coalesce(jsonb_agg(t order by (t->>'enviados')::int desc), '[]') from (
        select jsonb_build_object('nome', coalesce(nullif(btrim(niche), ''), 'Sem nicho'), 'enviados', count(*), 'responderam', count(r1), 'apresentacao', count(p1), 'continuaram', count(r2)) t
        from estado group by coalesce(nullif(btrim(niche), ''), 'Sem nicho') having count(*) >= 3 order by count(*) desc limit 8) z),
    'por_horario', (select coalesce(jsonb_agg(t order by t->>'ordem'), '[]') from (
        select jsonb_build_object('ordem', ord, 'nome', nome, 'enviados', count(*), 'responderam', count(r1)) t from (
          select r1, case when extract(hour from g1 at time zone 'America/Sao_Paulo') < 12 then 1 when extract(hour from g1 at time zone 'America/Sao_Paulo') < 18 then 2 else 3 end ord,
                 case when extract(hour from g1 at time zone 'America/Sao_Paulo') < 12 then 'Manhã (até 12h)' when extract(hour from g1 at time zone 'America/Sao_Paulo') < 18 then 'Tarde (12h–18h)' else 'Noite (depois das 18h)' end nome
          from estado) q group by ord, nome) z),
    'por_dia', (select coalesce(jsonb_agg(t order by (t->>'ordem')::int), '[]') from (
        select jsonb_build_object('ordem', dow, 'nome', (array['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'])[dow + 1], 'enviados', count(*), 'responderam', count(r1)) t
        from (select r1, extract(dow from g1 at time zone 'America/Sao_Paulo')::int dow from estado) q group by dow) z),
    'por_estrategia', (select coalesce(jsonb_agg(t order by t->>'nome'), '[]') from (
        select jsonb_build_object('nome', 'Estratégia ' || estrategia, 'enviados', count(*), 'responderam', count(r1)) t
        from estado where estrategia is not null group by estrategia) z),
    'por_estilo', (select coalesce(jsonb_agg(t order by t->>'nome'), '[]') from (
        select jsonb_build_object('nome', 'Estilo ' || estilo, 'enviados', count(*), 'responderam', count(r1)) t
        from estado where estilo is not null group by estilo) z)
  ) into out;
  return out;
end $$;
revoke all on function public.analysis_core(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.analysis_core(timestamptz, timestamptz) to service_role;

create or replace function public.admin_analysis(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_admin();
  return public.analysis_core(p_from, p_to);
end $$;
revoke all on function public.admin_analysis(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_analysis(timestamptz, timestamptz) to authenticated;
