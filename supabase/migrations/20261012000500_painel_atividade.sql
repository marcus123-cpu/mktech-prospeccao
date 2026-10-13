-- Contagens operacionais calculadas no banco, sem baixar milhares de linhas
-- para o painel e sem truncar o histórico em 1.000/2.000 registros.
create or replace function public.dashboard_activity() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tz constant text := 'America/Sao_Paulo';
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  day_from timestamptz;
  week_from timestamptz;
  result jsonb;
begin
  perform require_admin();
  day_from := today::timestamp at time zone tz;
  week_from := (today - 6)::timestamp at time zone tz;

  select jsonb_build_object(
    'sent_today', (select count(*) from outreach_messages where greeting_sent_at >= day_from),
    'texts_today', (select count(*) from outreach_messages where sent_at >= day_from),
    'human_today', (select count(*) from outreach_replies where kind = 'humana' and received_at >= day_from),
    'optouts_today', (select count(*) from outreach_replies where opt_out and received_at >= day_from),
    'ready_count', (select count(*) from outreach_messages where status = 'pronta'),
    'by_column', (select coalesce(jsonb_object_agg(coluna, n), '{}'::jsonb) from
      (select coluna, count(*) as n from outreach_funnel where coluna is not null group by coluna) x),
    'days', (select coalesce(jsonb_agg(jsonb_build_object(
      'day', d.day, 'saudacoes', coalesce(g.n, 0), 'respostas', coalesce(r.n, 0)) order by d.day), '[]'::jsonb)
      from generate_series(today - 6, today, interval '1 day') d(day)
      left join (select (greeting_sent_at at time zone tz)::date as day, count(*) as n
        from outreach_messages where greeting_sent_at >= week_from
        group by 1) g on g.day = d.day::date
      left join (select (received_at at time zone tz)::date as day, count(*) as n
        from outreach_replies where kind = 'humana' and received_at >= week_from
        group by 1) r on r.day = d.day::date)
  ) into result;
  return result;
end $$;
revoke execute on function public.dashboard_activity() from public, anon, authenticated;
grant execute on function public.dashboard_activity() to authenticated;

create index outreach_messages_greeting_recent_idx on public.outreach_messages (greeting_sent_at)
  where greeting_sent_at is not null;
create index outreach_messages_sent_recent_idx on public.outreach_messages (sent_at)
  where sent_at is not null;
create index outreach_replies_human_recent_idx on public.outreach_replies (received_at)
  where kind = 'humana';
create index outreach_replies_optout_recent_idx on public.outreach_replies (received_at)
  where opt_out;
