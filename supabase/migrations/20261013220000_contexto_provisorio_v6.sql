-- Transporte não é interpretação semântica.
create or replace function public.api_commercial_v6_contexts(p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
   (select id,coalesce(nullif(body,''),'[Mídia recebida: '||media||']') as body,media,received_at,'pendente_semantica'::text as kind,kind as transport_kind from outreach_replies where lead_id=c.lead_id and semantic_interpretation is null
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
  ctx:=ctx||jsonb_build_object('messages',coalesce((select jsonb_agg(case when exists(select 1 from outreach_replies unresolved where unresolved.lead_id=c.lead_id and unresolved.semantic_interpretation is null and m->>'id' like unresolved.id::text||':%') then m||jsonb_build_object('kind','pendente_semantica','source','entrada_pendente') else m end) from jsonb_array_elements(ctx->'messages') m),'[]'));
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
create or replace function public.api_commercial_v6_save(p_token uuid,p_lease uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
   update outreach_replies set semantic_interpretation=null,kind=(select coalesce(m->>'transport_kind',m->>'kind') from jsonb_array_elements(snapshot->'pending_messages') m where m->>'id'=i->>'message_id') where id=(i->>'message_id')::uuid;
  end loop;
 end if;
 return r;
end $$;