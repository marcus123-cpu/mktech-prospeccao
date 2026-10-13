create function public.api_commercial_v6_contexts(p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; x jsonb; c commercial_leads; lid uuid; ctx jsonb; pending jsonb; tz text; contexts jsonb:='[]';
begin
 if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
 perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
 if (select engine_version from commercial_settings where id=1)<>'v6' then return jsonb_build_object('status','v4','contexts','[]'::jsonb); end if;
 r:=api_commercial_pending(p_token,1);
 for x in select value from jsonb_array_elements(r->'contexts') loop
  select * into c from commercial_leads where lead_id=(x->>'lead_id')::uuid for update;
  if (x->>'first_contact')::boolean and not (select new_contacts_enabled from commercial_settings where id=1) then continue; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by received_at,id),'[]') into pending from
   (select id,coalesce(nullif(body,''),'[Mídia recebida: '||media||']') as body,media,received_at,kind from outreach_replies where lead_id=c.lead_id and semantic_interpretation is null
    and (c.active_test_run is null or received_at>=(select started_at from commercial_test_runs where id=c.active_test_run)) order by received_at,id limit 20) t;
  -- Agrupa mensagens rápidas antes de decidir. Nunca responder entre eventos simultâneos.
  if exists(select 1 from outreach_replies where lead_id=c.lead_id and received_at>now()-interval '3 seconds') then continue; end if;
  tz:=c.recipient_timezone;
  if tz is null and (select upper(state) from leads where id=c.lead_id)='SP' then tz:='America/Sao_Paulo'; end if;
  if tz is not null and not exists(select 1 from pg_timezone_names where name=tz) then tz:=null; end if;
  lid:=gen_random_uuid();
  ctx:=x||jsonb_build_object('lease_id',lid,'pending_messages',pending,'recipient_timezone',tz,'readiness',c.readiness,
   'followup_due',coalesce(c.followup_at<=now() and nullif(c.followup_reason,'') is not null,false),
   'phase',case when c.conversation_phase='NEEDS_RESEARCH' and not (x->>'first_contact')::boolean then 'WAITING_FIRST_REPLY' else c.conversation_phase end,
   'commercial_memory',c.commercial_memory);
  if c.active_test_run is not null then
   ctx:=ctx||jsonb_build_object('research',(select research from commercial_test_runs where id=c.active_test_run),'is_simulation',true,
    'messages',coalesce((select jsonb_agg(m) from jsonb_array_elements(x->'messages') m where (m->>'occurred_at')::timestamptz>=(select started_at from commercial_test_runs where id=c.active_test_run)),'[]'),
    'demonstration_history',coalesce((select jsonb_agg(jsonb_build_object('demonstration_id',demonstration_id,'status',status,'sent_at',sent_at)) from commercial_outbox where lead_id=c.lead_id and kind='demo' and test_run_id=c.active_test_run),'[]'));
  end if;
  update commercial_leads set lease_id=lid,lease_token=p_token,lease_until=now()+interval '3 minutes',lease_context=ctx,recipient_timezone=tz where lead_id=c.lead_id;
  contexts:=contexts||jsonb_build_array(ctx);
 end loop;
 return r||jsonb_build_object('contexts',contexts);
end $$;

create function public.api_commercial_v6_snapshot(p_token uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
 return (select lease_context from commercial_leads where lease_id=p_lease and lease_token=p_token and lease_until>now());
end $$;

create function public.admin_commercial_v6_test_begin(p_research jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l leads; c commercial_leads; run_id uuid; decision_id uuid; latest uuid;
begin
 perform require_admin();
 perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
 if not exists(select 1 from commercial_settings where id=1 and engine_version='v6' and test_mode and test_phones=array['+5517992250729']) then raise exception 'Teste restrito ao número autorizado +5517992250729'; end if;
 if p_research->>'simulation' is distinct from 'true' then raise exception 'Diagnóstico demonstrativo deve identificar simulação'; end if;
 select * into l from leads where phone_e164='+5517992250729' for update;
 select * into c from commercial_leads where lead_id=l.id for update;
 if c.lead_id is null or c.active_test_run is not null or l.do_not_contact then raise exception 'Lead de teste indisponível'; end if;
 if exists(select 1 from commercial_outbox where status='enviando') then raise exception 'Aguardar transmissão em andamento'; end if;
 insert into commercial_test_runs(lead_id,profile_snapshot,lead_snapshot,memory_snapshot,research) values(l.id,to_jsonb(c),to_jsonb(l),(select to_jsonb(m) from lead_conversation_memory m where lead_id=l.id),p_research) returning id into run_id;
 select id into latest from outreach_replies where lead_id=l.id order by received_at desc,id desc limit 1;
 update leads set secretary_handoff_at=null,secretary_handoff_reason=null where id=l.id;
 update commercial_leads set eligible=true,eligibility_reason='Teste real V6 autorizado pelo operador no próprio número',active_test_run=run_id,
  stage='CONTATO_ENVIADO',role='UNKNOWN',role_confidence=0,role_evidence='',facts='{}',video_offered=false,video_authorized=false,video_sent_at=null,
  conversation_phase='GREETING_PENDING',processed_reply=latest,revision=revision+1,recipient_timezone='America/Sao_Paulo',
  commercial_memory='{"summary":"Sessão de teste V6 com diagnóstico explicitamente simulado","confirmed_facts":[],"uncertain_facts":[],"answered_questions":[],"objections":[],"next_action":"Aguardar resposta ao teste","solution":null,"introduced":false,"channel_confirmed":false,"wait_acknowledged":[]}',
  lease_id=null,lease_context=null,lease_until=null,lease_token=null,retry_not_before=null,followup_at=null,followup_reason=null where lead_id=l.id;
 insert into commercial_decisions(lead_id,intent,objective,reason,action,body,state,semantic_metadata) values(l.id,'greeting_v6','Teste real controlado','Teste autorizado com diagnóstico simulado','text','Olá! Tudo bem?',to_jsonb(c),jsonb_build_object('test_run_id',run_id)) returning id into decision_id;
 insert into commercial_outbox(lead_id,decision_id,idempotency_key,kind,body,phone_e164,test_run_id) values(l.id,decision_id,run_id::text||':test-greeting','reply','Olá! Tudo bem?',l.phone_e164,run_id);
 return jsonb_build_object('status','registrado','test_run_id',run_id,'lead_id',l.id);
end $$;
revoke execute on function public.admin_commercial_v6_test_begin(jsonb) from public,anon,service_role;
grant execute on function public.admin_commercial_v6_test_begin(jsonb) to authenticated;

create function public.admin_commercial_v6_test_end(p_run uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t commercial_test_runs; old commercial_leads;
begin
 perform require_admin();
 perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
 select * into t from commercial_test_runs where id=p_run for update;
 if t.id is null or t.ended_at is not null then return jsonb_build_object('status','existente'); end if;
 if exists(select 1 from commercial_outbox where test_run_id=p_run and status='enviando') then raise exception 'Aguardar confirmação do envio de teste'; end if;
 update commercial_test_runs set ended_at=now(),final_snapshot=(select to_jsonb(c) from commercial_leads c where c.lead_id=t.lead_id) where id=p_run;
 update commercial_outbox set status='cancelada',error='Sessão de teste encerrada' where test_run_id=p_run and status='enfileirada';
 old:=jsonb_populate_record(null::commercial_leads,t.profile_snapshot);
 update commercial_leads set active_test_run=null,stage=old.stage,role=old.role,role_confidence=old.role_confidence,role_evidence=old.role_evidence,
  eligible=old.eligible,eligibility_reason=old.eligibility_reason,facts=old.facts,video_offered=old.video_offered,video_authorized=old.video_authorized,video_sent_at=old.video_sent_at,
  followup_at=old.followup_at,followup_reason=old.followup_reason,commercial_memory=old.commercial_memory,conversation_phase=old.conversation_phase,
  readiness=old.readiness,processed_reply=(select id from outreach_replies where lead_id=t.lead_id order by received_at desc,id desc limit 1),revision=revision+1,
  lease_id=null,lease_token=null,lease_context=null,lease_until=null,retry_not_before=null where lead_id=t.lead_id;
 update leads set secretary_handoff_at=nullif(t.lead_snapshot->>'secretary_handoff_at','')::timestamptz,secretary_handoff_reason=t.lead_snapshot->>'secretary_handoff_reason' where id=t.lead_id;
 -- O histórico completo do teste permanece nas tabelas e no snapshot final.
 update lead_conversation_memory set summary=coalesce(t.memory_snapshot->>'summary',''),facts=coalesce(t.memory_snapshot->>'facts',''),objections=coalesce(t.memory_snapshot->>'objections',''),next_action=coalesce(t.memory_snapshot->>'next_action',''),updated_at=now() where lead_id=t.lead_id;
 return jsonb_build_object('status','registrado','test_run_id',p_run);
end $$;
revoke execute on function public.admin_commercial_v6_test_end(uuid) from public,anon,service_role;
grant execute on function public.admin_commercial_v6_test_end(uuid) to authenticated;

create function public.api_commercial_v6_failure(p_token uuid,p_lease uuid,p_reason text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c commercial_leads;
begin
 if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
 select * into c from commercial_leads where lease_id=p_lease and lease_token=p_token for update;
 if c.lead_id is null then return jsonb_build_object('status','desatualizada'); end if;
 update commercial_leads set lease_id=null,lease_context=null,lease_until=null,lease_token=null,inference_failures=inference_failures+1,
  retry_not_before=now()+make_interval(secs=>least(900,30*(inference_failures+1))) where lead_id=c.lead_id;
 if c.inference_failures=2 then insert into commercial_notifications(lead_id,title,detail) values(c.lead_id,'Interpretação V6 indisponível',left(p_reason,300)); end if;
 return jsonb_build_object('status','aguardar');
end $$;

create function public.api_commercial_v6_save(p_token uuid,p_lease uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c commercial_leads; r jsonb; i jsonb; latest uuid; snapshot jsonb; pending_ids jsonb; snapshot_ids jsonb;
begin
 if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
 perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
 select * into c from commercial_leads where lease_id=p_lease and lease_token=p_token for update;
 if c.lead_id is null or c.lease_until<=now() or (select engine_version from commercial_settings where id=1)<>'v6' then return jsonb_build_object('status','desatualizada'); end if;
 snapshot:=c.lease_context;
 select id into latest from outreach_replies where lead_id=c.lead_id order by received_at desc,id desc limit 1;
 select coalesce(jsonb_agg(id order by received_at,id),'[]') into pending_ids from
  (select id,received_at from outreach_replies where lead_id=c.lead_id and semantic_interpretation is null and
   (c.active_test_run is null or received_at>=(select started_at from commercial_test_runs where id=c.active_test_run)) order by received_at,id limit 20) t;
 select coalesce(jsonb_agg(value->'id'),'[]') into snapshot_ids from jsonb_array_elements(snapshot->'pending_messages');
 if c.revision<>(snapshot->>'revision')::integer or latest is distinct from nullif(snapshot->>'reply_id','')::uuid or pending_ids<>snapshot_ids then return jsonb_build_object('status','desatualizada'); end if;
 if jsonb_array_length(coalesce(p->'validation_errors','[]'))>0 then return api_commercial_v6_failure(p_token,p_lease,'Validação semântica recusada'); end if;
 -- Primeiro persiste classificação semântica; a função existente mantém consentimento e deduplicação.
 for i in select value from jsonb_array_elements(p->'interpretations') loop
  if not exists(select 1 from jsonb_array_elements(snapshot->'pending_messages') m where m->>'id'=i->>'message_id') then raise exception 'mensagem fora do contexto'; end if;
  update outreach_replies set semantic_interpretation=i,kind=case when i->>'type'='human' then 'humana' else 'automatica' end where id=(i->>'message_id')::uuid and lead_id=c.lead_id;
 end loop;
 r:=api_commercial_save(p_token,c.lead_id,c.revision,nullif(snapshot->>'reply_id','')::uuid,p);
 if r->>'status'='registrado' then
  update commercial_leads set conversation_phase=p->>'phase',readiness=p->'readiness',commercial_memory=p->'memory',lease_id=null,lease_token=null,lease_until=null,lease_context=null,inference_failures=0,
   retry_not_before=case when (snapshot->>'first_contact')::boolean and p->>'action'='wait' then now()+interval '1 hour' else null end where lead_id=c.lead_id;
  update commercial_decisions set semantic_metadata=jsonb_build_object('model',p->>'model','interpretations',p->'interpretations','phase',p->>'phase','readiness',p->'readiness') where id=(r->>'decision_id')::uuid;
  insert into lead_conversation_memory(lead_id,summary,facts,objections,next_action,updated_by)
   values(c.lead_id,p->'memory'->>'summary',left((p->'memory'->'confirmed_facts')::text,3000),left((p->'memory'->'objections')::text,2000),p->'memory'->>'next_action',null)
   on conflict(lead_id) do update set summary=excluded.summary,facts=excluded.facts,objections=excluded.objections,next_action=excluded.next_action,updated_at=now(),updated_by=excluded.updated_by;
 else
  -- A classificação é válida apenas quando a decisão inteira foi aceita.
  for i in select value from jsonb_array_elements(p->'interpretations') loop
   update outreach_replies set semantic_interpretation=null,kind=(select m->>'kind' from jsonb_array_elements(snapshot->'pending_messages') m where m->>'id'=i->>'message_id') where id=(i->>'message_id')::uuid;
  end loop;
 end if;
 return r;
end $$;

alter function public.api_outreach_reply(uuid,jsonb) rename to api_outreach_reply_before_v6;
create function public.api_outreach_reply(p_token uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; v6 boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
 v6:=(select engine_version='v6' from commercial_settings where id=1);
 -- Classificação de transporte é provisória, não prova que a pessoa respondeu.
 r:=api_outreach_reply_before_v6(p_token,case when v6 then p||jsonb_build_object('kind','automatica') else p end);
 if v6 and r->>'status'='registrada' then
  update commercial_leads set revision=revision+1,lease_id=null,lease_until=null,lease_context=null,lease_token=null,retry_not_before=null where lead_id=(r->>'lead_id')::uuid;
  update commercial_outbox set status='cancelada',error='Nova entrada: reavaliar contexto V6' where lead_id=(r->>'lead_id')::uuid and status='enfileirada' and kind<>'initial';
 end if;
 return r;
end $$;

alter function public.api_outreach_next(uuid) rename to api_outreach_next_before_v6;
create function public.api_outreach_next(p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; b commercial_outbox; c commercial_leads; h integer; greeting text;
begin
 perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
 if not (select new_contacts_enabled from commercial_settings where id=1) then
  update commercial_outbox set due_at=greatest(due_at,now()+interval '30 seconds') where status='enfileirada' and kind='initial';
 end if;
 if (select engine_version='v6' from commercial_settings where id=1) then
  -- Não liberar primeiras abordagens V4 já na fila ao ativar V6.
  update commercial_outbox queued set status='cancelada',error='Requer diagnóstico e decisão V6'
   where queued.status='enfileirada' and queued.kind='initial' and not exists(select 1 from commercial_decisions d where d.id=queued.decision_id and d.intent='greeting_v6');
 end if;
 r:=api_outreach_next_before_v6(p_token);
 if r->>'status'='enviar' and r->>'etapa'='comercial' then
  select * into b from commercial_outbox where id=(r->>'id')::uuid;
  if exists(select 1 from commercial_decisions where id=b.decision_id and intent='greeting_v6') then
   select * into c from commercial_leads where lead_id=b.lead_id;
   if (c.active_test_run is null and c.readiness->>'status' is distinct from 'READY_FOR_OUTREACH') or c.recipient_timezone is null then
    update commercial_outbox set status='cancelada',error='Prontidão V6 não confirmada' where id=b.id;
    return jsonb_build_object('status','aguardar','segundos',30);
   end if;
   h:=extract(hour from now() at time zone c.recipient_timezone);
   greeting:='Olá, '||case when h between 5 and 11 then 'bom dia' when h between 12 and 17 then 'boa tarde' else 'boa noite' end||'! Tudo bem?';
   update commercial_outbox set body=greeting where id=b.id;
   update commercial_decisions set body=greeting where id=b.decision_id;
   r:=jsonb_set(r,'{texto}',to_jsonb(greeting));
  end if;
 end if;
 return r;
end $$;

-- Todas as novas operações são exclusivas do servidor autenticado, sem acesso anônimo.
alter function public.admin_commercial_settings(jsonb) rename to admin_commercial_settings_before_v6;
create function public.admin_commercial_settings(p jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform require_admin();
 perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
 if p ? 'engine_version' and p->>'engine_version' not in ('v4','v6') then raise exception 'versão inválida'; end if;
 if p->>'engine_version'='v6' and not coalesce((p->>'test_mode')::boolean,(select test_mode from commercial_settings where id=1)) then raise exception 'V6 requer validação em modo teste antes de produção'; end if;
 perform admin_commercial_settings_before_v6(p-'engine_version'-'new_contacts_enabled');
 update commercial_settings set engine_version=coalesce(p->>'engine_version',engine_version),new_contacts_enabled=coalesce((p->>'new_contacts_enabled')::boolean,new_contacts_enabled) where id=1;
end $$;
revoke execute on function public.admin_commercial_settings_before_v6(jsonb) from public,anon,authenticated,service_role;
revoke execute on function public.admin_commercial_settings(jsonb) from public,anon;
grant execute on function public.admin_commercial_settings(jsonb) to authenticated;
alter function public.api_commercial_result(uuid,uuid,text,text,text) rename to api_commercial_result_before_v6;
create function public.api_commercial_result(p_token uuid,p_id uuid,p_status text,p_provider text,p_error text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; b commercial_outbox; d commercial_decisions;
begin
 r:=api_commercial_result_before_v6(p_token,p_id,p_status,p_provider,p_error);
 select * into b from commercial_outbox where id=p_id;
 select * into d from commercial_decisions where id=b.decision_id;
 if r->>'status'='registrado' and b.sent_at is not null and d.semantic_metadata is not null then
  update commercial_leads set conversation_phase=case when b.kind='initial' or d.intent='greeting_v6' then 'WAITING_FIRST_REPLY' when b.kind='demo' then 'DEMO_SENT' else conversation_phase end,
   commercial_memory=case when b.body ilike '%assistente comercial da MKTech Dev%' then jsonb_set(commercial_memory,'{introduced}','true'::jsonb) else commercial_memory end where lead_id=b.lead_id;
  if d.intent like '%WAIT_REQUEST%' and d.reply_id is not null then
   update commercial_leads set commercial_memory=jsonb_set(commercial_memory,'{wait_acknowledged}',
    coalesce(commercial_memory->'wait_acknowledged','[]')||jsonb_build_array((select lower(btrim(body)) from outreach_replies where id=d.reply_id)))
    where lead_id=b.lead_id and not (commercial_memory->'wait_acknowledged' @> jsonb_build_array((select lower(btrim(body)) from outreach_replies where id=d.reply_id)));
  end if;
 end if;
 return r;
end $$;
revoke execute on function public.api_commercial_result_before_v6(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.api_commercial_result(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.api_commercial_result(uuid,uuid,text,text,text) to service_role;
revoke execute on function public.api_outreach_reply_before_v6(uuid,jsonb),public.api_outreach_next_before_v6(uuid) from public,anon,authenticated,service_role;
revoke execute on function public.api_commercial_v6_contexts(uuid),public.api_commercial_v6_snapshot(uuid,uuid),public.api_commercial_v6_failure(uuid,uuid,text),public.api_commercial_v6_save(uuid,uuid,jsonb),public.api_outreach_reply(uuid,jsonb),public.api_outreach_next(uuid) from public,anon,authenticated;
grant execute on function public.api_commercial_v6_contexts(uuid),public.api_commercial_v6_snapshot(uuid,uuid),public.api_commercial_v6_failure(uuid,uuid,text),public.api_commercial_v6_save(uuid,uuid,jsonb),public.api_outreach_reply(uuid,jsonb),public.api_outreach_next(uuid) to service_role;
