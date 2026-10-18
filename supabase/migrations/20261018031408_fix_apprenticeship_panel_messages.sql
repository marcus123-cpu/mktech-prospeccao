-- Conta mensagens enviadas pelo painel como trabalho humano; ignora envios pendentes ou falhos.
-- CREATE OR REPLACE preserva as permissoes restritas existentes.
create or replace function public.apprenticeship_day_stats(p_day date) returns jsonb language sql stable security definer set search_path = public as $$
  with e as (
    select * from conversation_timeline
    where source not in ('painel_pendente','painel_falhou','simulada') and (occurred_at at time zone 'America/Sao_Paulo')::date = p_day
  )
  select jsonb_build_object(
    'leads', (select count(distinct lead_id) from e),
    'suas_mensagens_texto', (select count(*) from e where source in ('manual','painel') and media = 'texto'),
    'seus_audios', (select count(*) from e where source in ('manual','painel') and media = 'audio'),
    'suas_outras_midias', (select count(*) from e where source in ('manual','painel') and media not in ('texto','audio')),
    'respostas_de_pessoas', (select count(*) from e where source = 'humana'),
    'respostas_automaticas', (select count(*) from e where source = 'automatica'),
    'saudacoes_enviadas', (select count(*) from e where source = 'saudacao'))
$$;

create or replace function public.api_apprenticeship_day_data(p_day date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  select coalesce(jsonb_agg(c order by c ->> 'last_at' desc), '[]') into out from (
    select jsonb_build_object('lead', l.business_name, 'niche', l.niche, 'city', l.city, 'stage', l.stage,
      'last_at', max(t.occurred_at),
      'events', (select jsonb_agg(jsonb_build_object('at', to_char(x.occurred_at at time zone 'America/Sao_Paulo', 'HH24:MI'),
          'who', case when x.direction = 'entrada' then (case when x.source = 'automatica' then 'resposta automática' else 'cliente' end)
                      when x.source in ('manual','painel') then 'VOCÊ' else 'sistema (saudação)' end,
          'media', x.media, 'text', left(x.body, 700)) order by x.occurred_at)
        from (select * from conversation_timeline y where y.source not in ('painel_pendente','painel_falhou','simulada') and y.lead_id = l.id and (y.occurred_at at time zone 'America/Sao_Paulo')::date = p_day order by y.occurred_at limit 30) x)) as c
    from conversation_timeline t join leads l on l.id = t.lead_id
    where t.source not in ('painel_pendente','painel_falhou','simulada') and (t.occurred_at at time zone 'America/Sao_Paulo')::date = p_day
    group by l.id order by max(t.occurred_at) desc limit 40
  ) s;
  return jsonb_build_object('day', p_day, 'stats', public.apprenticeship_day_stats(p_day), 'conversations', out);
end $$;
