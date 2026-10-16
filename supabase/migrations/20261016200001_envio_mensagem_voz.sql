-- Extends the existing admin-controlled manual queue. Keep after audio_e_resposta_manual.
alter table public.manual_outbox
  add column media text not null default 'texto' check(media in ('texto','audio')),
  add column audio_path text,
  add column audio_mime text,
  add constraint manual_audio_fields check(media <> 'audio' or (audio_path is not null and audio_mime is not null));

create function public.admin_send_voice_reply(p_lead uuid,p_id uuid,p_path text,p_mime text,p_bytes integer) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare l leads;
begin
  perform require_admin();
  if p_path is distinct from 'voice-outbox/'||p_id::text||'/original'
     or p_mime not in ('audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/webm','audio/aac')
     or p_bytes is null or p_bytes not between 1 and 3145728 or p_id is null then
    raise exception 'Áudio inválido' using errcode='22023';
  end if;
  -- Match the sender/handoff lock order before taking the lead row lock.
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  perform pg_advisory_xact_lock(hashtextextended('mktech-secretario',0));
  select * into l from leads where id=p_lead for update;
  if not found or l.phone_e164 is null or l.do_not_contact then
    raise exception 'Este contato não pode receber mensagens' using errcode='22023';
  end if;
  if l.secretary_handoff_at is null then perform admin_take_conversation(p_lead); end if;
  insert into chat_audio(external_id,storage_path,mime,bytes) values('voice:'||p_id::text,p_path,p_mime,p_bytes);
  insert into manual_outbox(id,lead_id,phone_e164,body,media,audio_path,audio_mime)
    values(p_id,p_lead,l.phone_e164,'Mensagem de voz','audio',p_path,p_mime);
  return p_id;
end $$;
revoke execute on function public.admin_send_voice_reply(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.admin_send_voice_reply(uuid,uuid,text,text,integer) to authenticated;

create or replace function public.api_manual_next(p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare b manual_outbox;
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-manual',0));
  update manual_outbox set status='falhou',error='Sem confirmação do envio; confira no WhatsApp antes de reenviar'
    where status='enviando' and claimed_at<now()-interval '5 minutes';
  update manual_outbox m set status='falhou',error='Contato bloqueado ou telefone alterado'
    from leads l where m.lead_id=l.id and m.status='enfileirada' and (l.do_not_contact or l.phone_e164 is distinct from m.phone_e164);
  if exists(select 1 from manual_outbox where status='enviando') then return jsonb_build_object('status','aguardar'); end if;
  select * into b from manual_outbox where status='enfileirada' order by created_at,id limit 1 for update skip locked;
  if not found then return jsonb_build_object('status','nenhum'); end if;
  update manual_outbox set status='enviando',claimed_at=now() where id=b.id;
  return jsonb_build_object('status','enviar','id',b.id,'telefone',b.phone_e164,'texto',b.body,'media',b.media,'audio_path',b.audio_path,'audio_mime',b.audio_mime);
end $$;

create or replace view public.conversation_timeline with (security_invoker=true) as
select id::text||':saudacao' as id,lead_id,greeting_sent_at as occurred_at,'saida'::text as direction,'saudacao'::text as source,greeting as body,'texto'::text as media,null::text as external_id from outreach_messages where greeting_sent_at is not null
union all select id::text||':mensagem',lead_id,sent_at,'saida','abordagem',body,'texto',null from outreach_messages where sent_at is not null
union all select id::text||':secretario',lead_id,sent_at,'saida','secretario',body,'texto',null from outreach_secretary where status='enviada'
union all select id::text||':lembrete',lead_id,sent_at,'saida','lembrete',body,'texto',null from outreach_followups where status='enviado'
union all select id::text||':cliente',lead_id,received_at,'entrada',kind,body,media,external_id from outreach_replies
union all select id::text||':manual',lead_id,sent_at,'saida','manual',body,media,external_id from outreach_outbound
union all select b.id::text||':v4',b.lead_id,b.sent_at,'saida',case when b.simulated then 'simulacao' else 'hermes_v4' end,b.body,case when b.kind='video' or (b.kind='demo' and (select config->>'kind' from commercial_demonstrations where id=b.demonstration_id)='video') then 'video' else 'texto' end,null from commercial_outbox b where b.sent_at is not null
union all select h.external_id||':historico',h.lead_id,h.occurred_at,h.direction,
case when h.direction='saida' then 'historico_saida' else 'historico_entrada' end,h.body,h.media,h.external_id
from public.whatsapp_history h
where not exists(select 1 from public.outreach_replies r where r.external_id=h.external_id)
and not exists(select 1 from public.outreach_outbound o where o.external_id=h.external_id)
and not exists(select 1 from public.commercial_outbox c where c.provider_id=h.external_id)
and not exists(select 1 from public.manual_outbox m where m.provider_id=h.external_id)
union all select m.id::text||':painel',m.lead_id,coalesce(m.sent_at,m.created_at),'saida',case m.status when 'enviada' then 'painel' when 'falhou' then 'painel_falhou' else 'painel_pendente' end,m.body,m.media,case when m.media='audio' then 'voice:'||m.id::text else null end from manual_outbox m;
