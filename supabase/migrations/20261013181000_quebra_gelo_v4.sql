-- Horário da saudação é calculado ao reservar o envio, não ao preparar a fila.
alter function public.api_outreach_next(uuid) rename to api_outreach_next_before_icebreaker;
revoke execute on function public.api_outreach_next_before_icebreaker(uuid) from public,anon,authenticated,service_role;
create function public.api_outreach_next(p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; greeting text; h integer; b commercial_outbox;
begin
  result:=api_outreach_next_before_icebreaker(p_token);
  if result->>'status'='enviar' and result->>'etapa'='comercial' then
    select * into b from commercial_outbox where id=(result->>'id')::uuid;
    if b.kind='initial' and exists(select 1 from commercial_decisions where id=b.decision_id and intent='quebra_gelo') then
      h:=extract(hour from now() at time zone 'America/Sao_Paulo');
      greeting:='Olá, '||case when h between 5 and 11 then 'bom dia' when h between 12 and 17 then 'boa tarde' else 'boa noite' end||'! Tudo bem?';
      update commercial_outbox set body=greeting where id=b.id;
      update commercial_decisions set body=greeting where id=b.decision_id;
      result:=jsonb_set(result,'{texto}',to_jsonb(greeting));
    end if;
  end if;
  return result;
end $$;
revoke execute on function public.api_outreach_next(uuid) from public,anon,authenticated;
grant execute on function public.api_outreach_next(uuid) to service_role;

-- Corrige só primeiras abordagens ainda na fila, sem repetir contatos enviados.
update commercial_decisions d set intent='quebra_gelo',objective='quebra_gelo',
  reason='Restaurar saudação antes da investigação contextual',action='text',
  body='Olá, boa tarde! Tudo bem?',
  state=jsonb_set(jsonb_set(d.state,'{facts}',(coalesce(d.state->'facts','{}'::jsonb)-'demo_offered')||'{"abertura":"saudacao"}'::jsonb),'{video_offered}','false'::jsonb)
where exists(select 1 from commercial_outbox b join leads l on l.id=b.lead_id
  where b.decision_id=d.id and b.kind='initial' and b.status='enfileirada' and b.sent_at is null and not l.contacted);
update commercial_outbox b set body=d.body,demonstration_id=null
from commercial_decisions d where b.decision_id=d.id and d.intent='quebra_gelo'
  and b.kind='initial' and b.status='enfileirada' and b.sent_at is null;
update commercial_leads c set facts=(c.facts-'demo_offered')||'{"abertura":"saudacao"}'::jsonb,
  video_offered=false,revision=c.revision+1
where exists(select 1 from commercial_outbox b join leads l on l.id=b.lead_id
  join commercial_decisions d on d.id=b.decision_id
  where b.lead_id=c.lead_id and b.kind='initial' and b.status='enfileirada'
  and b.sent_at is null and not l.contacted and d.intent='quebra_gelo');
