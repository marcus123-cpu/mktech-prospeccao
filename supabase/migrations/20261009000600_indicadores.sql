-- Indicadores do dashboard, calculados só a partir dos dados gravados.
-- O período é um intervalo de datas (inclusivo) no fuso America/Sao_Paulo.
--
-- Definições:
--   coorte de contato   = leads cujo PRIMEIRO contato válido com data caiu no período;
--   respondeu           = lead que em algum momento chegou a respondeu, interessado,
--                         proposta_enviada ou fechado (histórico de etapas);
--   taxa de resposta    = coorte que respondeu / coorte;
--   conversão em venda  = coorte que fechou / coorte;
--   conversão propostas = leads cuja primeira proposta caiu no período e fecharam / esses leads.
-- Contatos anulados por correção não contam. Contatos importados sem data
-- contam como "contatado", mas não entram em nenhum período.
-- Taxas sem denominador voltam como null (o painel mostra "—").

create or replace function public.dashboard_metrics(p_start date, p_end date) returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare
  tz constant text := 'America/Sao_Paulo';
  v_from timestamptz;
  v_to timestamptz;
  v_today_from timestamptz;
  v_today_to timestamptz;
  v_cohort integer;
  v_cohort_responded integer;
  v_cohort_closed integer;
  v_prop_cohort integer;
  v_prop_closed integer;
  result jsonb;
begin
  perform require_admin();
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 731 then
    raise exception 'período inválido' using errcode = '22023';
  end if;
  v_from := p_start::timestamp at time zone tz;
  v_to := (p_end + 1)::timestamp at time zone tz;
  v_today_from := (now() at time zone tz)::date::timestamp at time zone tz;
  v_today_to := v_today_from + interval '1 day';

  with cohort as (
    select l.id, l.stage
    from leads l
    where l.first_contact_at >= v_from and l.first_contact_at < v_to
  ),
  responded as (
    select distinct lead_id from stage_events
    where to_stage in ('respondeu', 'interessado', 'proposta_enviada', 'fechado')
  )
  select count(*),
         count(*) filter (where c.id in (select lead_id from responded)),
         count(*) filter (where c.stage = 'fechado')
  into v_cohort, v_cohort_responded, v_cohort_closed
  from cohort c;

  with first_prop as (
    select lead_id, min(sent_at) as first_sent from proposals group by lead_id
  )
  select count(*), count(*) filter (where l.stage = 'fechado')
  into v_prop_cohort, v_prop_closed
  from first_prop fp join leads l on l.id = fp.lead_id
  where fp.first_sent >= v_from and fp.first_sent < v_to;

  result := jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end, 'timezone', tz),
    'total_leads', (select count(*) from leads),
    'new_leads', (select count(*) from leads where created_at >= v_from and created_at < v_to),
    'contact_actions', (select count(*) from contact_events
                        where voided_at is null and occurred_at >= v_from and occurred_at < v_to),
    'contacted_leads', (select count(distinct lead_id) from contact_events
                        where voided_at is null and occurred_at >= v_from and occurred_at < v_to),
    'first_contacts', v_cohort,
    'contacted_total', (select count(*) from leads where contacted),
    'contacted_undated', (select count(*) from leads where contacted and contact_date_unknown),
    'responded', (select count(distinct lead_id) from stage_events
                  where to_stage = 'respondeu' and changed_at >= v_from and changed_at < v_to),
    'interested', (select count(distinct lead_id) from stage_events
                   where to_stage = 'interessado' and changed_at >= v_from and changed_at < v_to),
    'proposals_sent', (select count(distinct lead_id) from proposals where sent_at >= v_from and sent_at < v_to),
    'closed_sales', (select count(*) from leads where stage = 'fechado' and closed_at >= v_from and closed_at < v_to),
    'closed_value', (select coalesce(sum(closed_value), 0) from leads
                     where stage = 'fechado' and closed_at >= v_from and closed_at < v_to),
    'disqualified', (select count(distinct lead_id) from stage_events
                     where to_stage = 'desqualificado' and changed_at >= v_from and changed_at < v_to),
    'follow_ups_overdue', (select count(*) from leads
                           where next_follow_up_at < v_today_from
                             and stage not in ('fechado', 'sem_interesse', 'desqualificado')),
    'follow_ups_today', (select count(*) from leads
                         where next_follow_up_at >= v_today_from and next_follow_up_at < v_today_to
                           and stage not in ('fechado', 'sem_interesse', 'desqualificado')),
    'duplicates_blocked', (select count(*) from dedupe_events where created_at >= v_from and created_at < v_to),
    'pending_reviews', (select count(*) from duplicate_reviews where status = 'pendente'),
    'response_rate', case when v_cohort > 0 then round(v_cohort_responded::numeric / v_cohort, 4) end,
    'sale_conversion', case when v_cohort > 0 then round(v_cohort_closed::numeric / v_cohort, 4) end,
    'proposal_conversion', case when v_prop_cohort > 0 then round(v_prop_closed::numeric / v_prop_cohort, 4) end,
    'rate_basis', jsonb_build_object(
      'cohort', v_cohort, 'cohort_responded', v_cohort_responded, 'cohort_closed', v_cohort_closed,
      'proposal_cohort', v_prop_cohort, 'proposal_closed', v_prop_closed),
    'last_run', (select to_jsonb(r) - 'config' - 'error_details' - 'token_id'
                 from hermes_runs r order by started_at desc limit 1),
    'by_stage', (select coalesce(jsonb_object_agg(stage, n), '{}')
                 from (select stage, count(*) n from leads group by stage) s),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d, 'new_leads', nl, 'contacts', ct) order by d), '[]')
      from (
        select d::date as d,
               (select count(*) from leads
                where (created_at at time zone tz)::date = d::date) as nl,
               (select count(*) from contact_events
                where voided_at is null and (occurred_at at time zone tz)::date = d::date) as ct
        from generate_series(p_start, p_end, interval '1 day') d
      ) x
    )
  );
  return result;
end
$$;
