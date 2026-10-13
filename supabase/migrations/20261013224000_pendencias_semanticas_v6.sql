-- Classificação pendente, sessão e reserva de correção sem repetir respostas.
create or replace function public.api_commercial_pending_core(p_token uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s commercial_settings; o outreach_settings; z record; c commercial_leads; v jsonb:='[]'; a text; counts integer; products jsonb;
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  update commercial_settings set last_worker_at=now() where id=1;
  select * into s from commercial_settings where id=1;
  select * into o from outreach_settings where id=1;
  if not s.enabled or not s.channel_authorized or not o.enabled or o.paused then return jsonb_build_object('status','desligado','contexts','[]'::jsonb); end if;
  select coalesce(jsonb_agg(to_jsonb(p)),'[]') into products from commercial_products p where approved;
  for z in select l.*,cl.lead_id as commercial_id,cl.score as commercial_score, r.id as reply_id, r.kind as reply_kind
    from leads l join commercial_leads cl on cl.lead_id=l.id
    left join lateral(select id,kind from outreach_replies where lead_id=l.id order by case when s.engine_version='v4' then (kind='humana')::integer else 0 end desc,received_at desc,id desc limit 1) r on true
    where cl.eligible and (s.engine_version='v4' or (coalesce(cl.retry_not_before,'-infinity')<=now() and (cl.lease_id is null or cl.lease_until<now()))) and not l.do_not_contact and l.secretary_handoff_at is null
      and l.stage not in ('fechado','sem_interesse','desqualificado') and cl.stage not in ('NAO_CONTATAR','PERDIDO','VENDA_FECHADA')
      and (not s.test_mode or l.phone_e164=any(s.test_phones)) and l.phone_e164 is not null
      and not exists(select 1 from commercial_outbox b where b.lead_id=l.id and b.status in ('enfileirada','enviando','desconhecido'))
      and not exists(select 1 from outreach_secretary b where b.lead_id=l.id and b.status in ('pronta','enviando'))
      and not exists(select 1 from outreach_messages b where b.lead_id=l.id and b.status in ('pronta','enviando_saudacao','saudacao_enviada','enviando_mensagem'))
      and ((s.new_contacts_enabled and not l.contacted and l.stage='novo' and cl.stage in ('NOVO','PESQUISADO','QUALIFICADO','PRONTO_PARA_CONTATO') and not exists(select 1 from commercial_outbox b where b.lead_id=l.id and b.status<>'cancelada'))
        or (s.engine_version='v6' and cl.followup_at<=now() and nullif(cl.followup_reason,'') is not null) or (r.id is not null and (r.id is distinct from cl.processed_reply or (s.engine_version='v6' and exists(select 1 from outreach_replies pending_reply where pending_reply.lead_id=l.id and semantic_interpretation is null and (cl.active_test_run is null or pending_reply.received_at>=(select started_at from commercial_test_runs where id=cl.active_test_run)))))))
    order by case when r.id is not null then 0 else 1 end,coalesce(cl.score,l.fit_score,0) desc,l.created_at,l.id limit greatest(1,least(coalesce(p_limit,5),20)) loop
    select * into c from commercial_leads where lead_id=z.id;
    if c.strategy is null then
      -- Distribuição balanceada dentro de cidade/faixa de score, sem escolher melhores leads para C.
      select x into a from unnest(s.allowed_strategies) x
      where not s.experiment_enabled or (select count(*) from commercial_leads where experiment and strategy=x) < s.experiment_size
      order by (select count(*) from commercial_leads cl join leads l on l.id=cl.lead_id
        where cl.strategy=x and l.city_norm=z.city_norm and coalesce(cl.score,l.fit_score,0)/20=coalesce(z.commercial_score,z.fit_score,0)/20),
        (select count(*) from commercial_leads where strategy=x), md5(z.id::text||x) limit 1;
      if a is null then continue; end if;
      update commercial_leads set strategy=a,experiment=s.experiment_enabled where lead_id=z.id returning * into c;
    end if;
    v := v || jsonb_build_array(jsonb_build_object('lead_id',z.id,'revision',c.revision,'reply_id',z.reply_id,
      'business_name',z.business_name,'city',z.city,'research',lead_approach_context(z.id), 'state',to_jsonb(c),
      'messages',coalesce((select jsonb_agg(to_jsonb(t) order by t.occurred_at,t.id) from
        (select h.*, case when h.source='automatica' then 'automatica' else 'humana' end as kind from conversation_timeline h where lead_id=z.id order by occurred_at desc,id desc limit 100) t),'[]'::jsonb),
      'products',products,'video_configured',s.video_configured,'manual',false,'do_not_contact',false,
      'memory',(select to_jsonb(mem)-'updated_by' from lead_conversation_memory mem where mem.lead_id=z.id),
      'first_contact',not z.contacted and z.stage='novo' and not exists(select 1 from commercial_outbox where lead_id=z.id and status<>'cancelada'),'now',now()));
  end loop;
  return jsonb_build_object('status','ok','contexts',v);
end $$;
create or replace function public.api_commercial_save_core(p_token uuid,p_lead uuid,p_revision integer,p_reply uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c commercial_leads; l leads; s commercial_settings; did uuid; bid uuid; st jsonb:=p->'state'; k text; latest uuid;
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into c from commercial_leads where lead_id=p_lead for update;
  select * into l from leads where id=p_lead;
  select * into s from commercial_settings where id=1;
  select id into latest from outreach_replies where lead_id=p_lead order by case when s.engine_version='v4' then (kind='humana')::integer else 0 end desc,received_at desc,id desc limit 1;
  if c.lead_id is null or c.revision <> p_revision or latest is distinct from p_reply then return jsonb_build_object('status','desatualizada'); end if;
  if not s.enabled or not s.channel_authorized or not c.eligible or l.secretary_handoff_at is not null or l.do_not_contact
     or not (select enabled and not paused from outreach_settings where id=1) then return jsonb_build_object('status','desligado'); end if;
  if p_reply is not null and p_reply=c.processed_reply and p->>'intent'<>'followup_v6' and (s.engine_version='v4' or jsonb_array_length(coalesce(p->'interpretations','[]'))=0) then return jsonb_build_object('status','existente'); end if;
  if p->>'action' not in ('text','video','demonstration','handoff','stop','wait') then raise exception 'ação inválida' using errcode='22023'; end if;
  if p->>'action'='video' and (not s.video_configured or not coalesce((st->>'video_authorized')::boolean,false)
    or c.video_sent_at is not null or not exists(select 1 from outreach_replies where id=p_reply and kind='humana' and not opt_out)) then return jsonb_build_object('status','invalido'); end if;
  perform set_config('app.commercial_reason',p->>'reason',true);
  update commercial_leads set stage=st->>'stage',role=st->>'role',role_confidence=(st->>'role_confidence')::numeric,role_evidence=left(st->>'role_evidence',1000),
    video_offered=coalesce((st->>'video_offered')::boolean,false),video_authorized=coalesce((st->>'video_authorized')::boolean,false),facts=coalesce(st->'facts','{}'),
    followup_at=nullif(st->>'followup_at','')::timestamptz,followup_reason=st->>'followup_reason',processed_reply=p_reply,revision=revision+1,
    score=coalesce((p->'score'->>'score')::integer,score),data_confidence=coalesce((p->'score'->>'confidence')::integer,data_confidence),score_details=coalesce(p->'score',score_details)
    where lead_id=p_lead;
  insert into commercial_decisions(lead_id,reply_id,intent,objective,reason,action,body,state)
  values(p_lead,p_reply,p->>'intent',p->>'objective',p->>'reason',p->>'action',p->>'body',st) returning id into did;
  if nullif(p->>'notification','') is not null then insert into commercial_notifications(lead_id,title,detail) values(p_lead,left(p->>'notification',200),left(p->>'reason',500)); end if;
  if p->>'action'='handoff' then
    update leads set secretary_handoff_at=now(),secretary_handoff_reason=left(p->>'reason',500) where id=p_lead;
  elsif p->>'action'='stop' then
    if st->>'stage'='NAO_CONTATAR' then update leads set do_not_contact=true,do_not_contact_at=now() where id=p_lead; end if;
    update commercial_leads set followup_at=null,followup_reason=null where lead_id=p_lead;
    update commercial_outbox set status='cancelada' where lead_id=p_lead and status='enfileirada';
  elsif p->>'action' in ('text','video','demonstration') and nullif(p->>'body','') is not null then
    k:=case when p->>'intent'='followup_v6' then 'followup' when p_reply is null then 'initial' when p->>'action'='demonstration' then 'demo' when p->>'action'='video' then 'video' when p->>'intent'='proposta_preparada' then 'proposal' else 'reply' end;
    insert into commercial_outbox(lead_id,decision_id,idempotency_key,kind,body,phone_e164,test_run_id)
    values(p_lead,did,p_lead::text||':'||coalesce(p_reply::text,'initial')||':'||p_revision::text,k,p->>'body',l.phone_e164,c.active_test_run)
    on conflict do nothing returning id into bid;
  end if;
  return jsonb_build_object('status','registrado','id',bid,'decision_id',did);
end $$;
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
   'answered_reply_ids',coalesce((select jsonb_agg(distinct decisions.reply_id) from commercial_decisions decisions join commercial_outbox sent on sent.decision_id=decisions.id where decisions.lead_id=c.lead_id and decisions.reply_id is not null and sent.sent_at is not null),'[]'),
   'phase',case when c.conversation_phase='NEEDS_RESEARCH' and not (x->>'first_contact')::boolean then 'WAITING_FIRST_REPLY' else c.conversation_phase end,
   'commercial_memory',c.commercial_memory);
  ctx:=ctx||jsonb_build_object('messages',coalesce((select jsonb_agg(case when exists(select 1 from outreach_replies unresolved where unresolved.lead_id=c.lead_id and unresolved.semantic_interpretation is null and m->>'id' like unresolved.id::text||':%') then m||jsonb_build_object('kind','pendente_semantica','source','entrada_pendente') else m end) from jsonb_array_elements(ctx->'messages') m),'[]'));
  if c.active_test_run is not null then
   ctx:=ctx||jsonb_build_object('research',(select research from commercial_test_runs where id=c.active_test_run),'is_simulation',true,
    'messages',coalesce((select jsonb_agg(m) from jsonb_array_elements(ctx->'messages') m where (m->>'occurred_at')::timestamptz>=(select started_at from commercial_test_runs where id=c.active_test_run)),'[]'),
    'demonstration_history',coalesce((select jsonb_agg(jsonb_build_object('demonstration_id',demonstration_id,'status',status,'sent_at',sent_at)) from commercial_outbox where lead_id=c.lead_id and kind='demo' and test_run_id=c.active_test_run),'[]'));
  end if;
  update commercial_leads set lease_id=lid,lease_token=p_token,lease_until=now()+interval '6 minutes',lease_context=ctx,recipient_timezone=tz where lead_id=c.lead_id;
  contexts:=contexts||jsonb_build_array(ctx);
 end loop;
 return r||jsonb_build_object('contexts',contexts);
end $$;