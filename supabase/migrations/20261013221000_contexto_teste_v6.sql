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
    'messages',coalesce((select jsonb_agg(m) from jsonb_array_elements(ctx->'messages') m where (m->>'occurred_at')::timestamptz>=(select started_at from commercial_test_runs where id=c.active_test_run)),'[]'),
    'demonstration_history',coalesce((select jsonb_agg(jsonb_build_object('demonstration_id',demonstration_id,'status',status,'sent_at',sent_at)) from commercial_outbox where lead_id=c.lead_id and kind='demo' and test_run_id=c.active_test_run),'[]'));
  end if;
  update commercial_leads set lease_id=lid,lease_token=p_token,lease_until=now()+interval '3 minutes',lease_context=ctx,recipient_timezone=tz where lead_id=c.lead_id;
  contexts:=contexts||jsonb_build_array(ctx);
 end loop;
 return r||jsonb_build_object('contexts',contexts);
end $$;