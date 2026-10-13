-- V6 permanece desativado até validação. Histórico e CRM existentes preservados.
alter table public.commercial_settings add column engine_version text not null default 'v4' check(engine_version in ('v4','v6'));
alter table public.commercial_settings add column new_contacts_enabled boolean not null default true;
alter table public.commercial_leads add column conversation_phase text not null default 'NEEDS_RESEARCH';
alter table public.commercial_leads add column recipient_timezone text;
alter table public.commercial_leads add column readiness jsonb not null default '{}';
alter table public.commercial_leads add column commercial_memory jsonb not null default '{"summary":"","confirmed_facts":[],"uncertain_facts":[],"answered_questions":[],"objections":[],"next_action":"","solution":null,"introduced":false,"channel_confirmed":false,"wait_acknowledged":[]}';
alter table public.commercial_leads add column lease_id uuid;
alter table public.commercial_leads add column lease_token uuid;
alter table public.commercial_leads add column lease_until timestamptz;
alter table public.commercial_leads add column lease_context jsonb;
alter table public.commercial_leads add column inference_failures integer not null default 0;
alter table public.commercial_leads add column retry_not_before timestamptz;
alter table public.outreach_replies add column semantic_interpretation jsonb;
alter table public.commercial_decisions add column semantic_metadata jsonb;
create index commercial_v6_pending_idx on public.outreach_replies(lead_id,received_at,id) where semantic_interpretation is null;
create table public.commercial_test_runs (
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references leads(id),started_at timestamptz not null default now(),ended_at timestamptz,
 profile_snapshot jsonb not null,lead_snapshot jsonb not null,memory_snapshot jsonb,final_snapshot jsonb,research jsonb not null,
 check(research->>'simulation'='true')
);
alter table public.commercial_test_runs enable row level security;
revoke all on public.commercial_test_runs from anon,authenticated;
grant select on public.commercial_test_runs to authenticated;
grant all on public.commercial_test_runs to service_role;
create policy commercial_test_admin_read on public.commercial_test_runs for select to authenticated using(is_admin());
alter table public.commercial_leads add column active_test_run uuid references commercial_test_runs(id);
alter table public.commercial_outbox add column test_run_id uuid references commercial_test_runs(id);
drop index public.commercial_demo_once;
create unique index commercial_demo_once on public.commercial_outbox(lead_id,demonstration_id) where kind='demo' and status<>'cancelada' and test_run_id is null;
create unique index commercial_demo_test_once on public.commercial_outbox(test_run_id,demonstration_id) where kind='demo' and status<>'cancelada' and test_run_id is not null;

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
        or (s.engine_version='v6' and cl.followup_at<=now() and nullif(cl.followup_reason,'') is not null) or (r.id is not null and (r.id is distinct from cl.processed_reply or (s.engine_version='v6' and exists(select 1 from outreach_replies pending_reply where pending_reply.lead_id=l.id and semantic_interpretation is null)))))
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
  if p_reply is not null and p_reply=c.processed_reply and p->>'intent'<>'followup_v6' then return jsonb_build_object('status','existente'); end if;
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
create or replace function public.api_commercial_save(p_token uuid,p_lead uuid,p_revision integer,p_reply uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d commercial_demonstrations; r jsonb; did text:=p->>'demonstration_id'; rec text:=p->'state'->'facts'->>'demo_recommended';
begin
 perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
 if p->>'action'='demonstration' then
  select * into d from commercial_demonstrations where id=did;
  if d.id is null or not (d.config->>'approved')::boolean or not d.available
   or (d.config->>'kind'='video' and (d.verified_at is null or d.verified_at<now()-interval '3 minutes'))
   or p->'state'->'facts'->>'demo_authorized' is distinct from did
   or not exists(select 1 from commercial_leads where lead_id=p_lead and facts->>'demo_offered'=did)
   or not exists(select 1 from lead_demonstrations where lead_id=p_lead and demonstration_id=did and offered_at is not null)
   or not exists(select 1 from outreach_replies where id=p_reply and lead_id=p_lead and kind='humana' and not opt_out)
   or exists(select 1 from commercial_outbox where lead_id=p_lead and demonstration_id=did and kind='demo' and status<>'cancelada' and test_run_id is not distinct from (select active_test_run from commercial_leads where lead_id=p_lead)) then return jsonb_build_object('status','invalido'); end if;
 end if;
 r:=api_commercial_save_core(p_token,p_lead,p_revision,p_reply,p);
 if r->>'status'='registrado' then
  if exists(select 1 from commercial_demonstrations where id=rec) then insert into lead_demonstrations(lead_id,demonstration_id) values(p_lead,rec) on conflict do nothing; end if;
  if exists(select 1 from commercial_demonstrations where id=did) then
   update commercial_outbox set demonstration_id=did where id=(r->>'id')::uuid;
   if p->>'action'='demonstration' then update lead_demonstrations set authorized_at=now(),authorization_reply_id=p_reply where lead_id=p_lead and demonstration_id=did; end if;
  end if;
 end if;
 return r;
end $$;
create or replace function public.api_outreach_next_core(p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s commercial_settings; o outreach_settings; b commercial_outbox; c commercial_leads; l leads; z record;
  local_now timestamp:=now() at time zone 'America/Sao_Paulo'; day_start timestamptz:=date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'; target integer;
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  update commercial_settings set last_sender_at=now() where id=1;
  select * into s from commercial_settings where id=1;
  update commercial_outbox set status='desconhecido',error='Sem confirmação; verificar na ponte antes de qualquer ação' where status='enviando' and claimed_at < now()-interval '5 minutes';
  perform set_config('app.commercial_reason','Sem resposta humana após dois dias úteis',true);
  update commercial_leads cl set stage='SEM_RESPOSTA',revision=revision+1 where cl.stage='CONTATO_ENVIADO'
    and exists(select 1 from commercial_outbox initial_box where initial_box.lead_id=cl.lead_id and initial_box.kind='initial' and initial_box.sent_at is not null and outreach_add_business_days(initial_box.sent_at,2)<=now())
    and not exists(select 1 from outreach_replies r where r.lead_id=cl.lead_id and r.kind='humana');
  if not s.enabled then
    if exists(select 1 from commercial_outbox where status='enviando') then return jsonb_build_object('status','aguardar','segundos',15); end if;
    return api_outreach_next_legacy(p_token);
  end if;
  select * into o from outreach_settings where id=1 for update;
  if not s.channel_authorized or not o.enabled then return jsonb_build_object('status','desligado'); end if;
  if o.paused then return jsonb_build_object('status','pausado'); end if;
  if not extract(isodow from local_now)::smallint=any(o.send_days) or extract(hour from local_now)<o.reply_window_start or extract(hour from local_now)>=o.reply_window_end then return jsonb_build_object('status','fora_do_horario'); end if;
  if exists(select 1 from commercial_outbox where status='enviando') or exists(select 1 from outreach_messages where status in ('enviando_saudacao','enviando_mensagem'))
    or exists(select 1 from outreach_secretary where status='enviando') or exists(select 1 from outreach_followups where status='enviando') then return jsonb_build_object('status','aguardar','segundos',15); end if;
  -- Apenas acompanhamentos explicitamente combinados/cadastrados. Uma mensagem por compromisso.
  for z in select cl.*,x.phone_e164 from commercial_leads cl join leads x on x.id=cl.lead_id
    where s.engine_version='v4' and cl.followup_at<=now() and nullif(cl.followup_reason,'') is not null and cl.eligible
      and cl.stage not in ('NAO_CONTATAR','PERDIDO','VENDA_FECHADA') and not x.do_not_contact and x.secretary_handoff_at is null
      and not exists(select 1 from commercial_outbox q where q.lead_id=cl.lead_id and q.status in ('enfileirada','enviando','desconhecido')) loop
    insert into commercial_outbox(lead_id,idempotency_key,kind,body,phone_e164)
    values(z.lead_id,z.lead_id::text||':followup:'||z.followup_at::text,'followup','Olá! Retornando na data combinada para saber se ficou alguma dúvida sobre a página para a clínica.',z.phone_e164) on conflict do nothing;
    update commercial_leads set followup_at=null,followup_reason=null where lead_id=z.lead_id;
  end loop;
  for b in select * from commercial_outbox where status='enfileirada' and due_at<=now() order by case when kind='initial' then 1 else 0 end,created_at loop
    select * into l from leads where id=b.lead_id;
    select * into c from commercial_leads where lead_id=b.lead_id;
    if l.do_not_contact or l.secretary_handoff_at is not null or not c.eligible or c.stage in ('NAO_CONTATAR','PERDIDO','VENDA_FECHADA') or l.stage in ('fechado','sem_interesse','desqualificado')
      or b.phone_e164 is distinct from l.phone_e164 or (s.test_mode and not l.phone_e164=any(s.test_phones)) then
      update commercial_outbox set status='cancelada',error='Lead inelegível ou controle manual' where id=b.id; continue;
    end if;
    if exists(select 1 from commercial_outbox where lead_id=b.lead_id and status='desconhecido') then continue; end if;
    if (select count(*) from commercial_outbox where lead_id=b.lead_id and status in ('enviada','entregue','desconhecido'))>=s.max_messages then
      update leads set secretary_handoff_at=now(),secretary_handoff_reason='Limite de mensagens atingido' where id=b.lead_id;
      update commercial_outbox set status='cancelada',error='Limite da conversa' where id=b.id; continue;
    end if;
    if b.kind='video' and (not c.video_authorized or c.video_sent_at is not null or not s.video_configured) then update commercial_outbox set status='cancelada',error='Sem autorização/material ou vídeo já enviado' where id=b.id; continue; end if;
    if b.kind in ('initial','followup') then
      if b.kind='initial' and coalesce(c.score,l.fit_score,0)<o.min_fit_score then continue; end if;
      if extract(hour from local_now)<o.window_start or extract(hour from local_now)>=o.window_end then continue; end if;
      if o.next_send_at>now() then continue; end if;
      target:=case when o.today_new_leads_date=local_now::date then o.today_new_leads_target else least(o.daily_limit,5) end;
      if b.kind='initial' and (select count(*) from commercial_outbox where kind='initial' and coalesce(sent_at,claimed_at)>=day_start and status in ('enviando','enviada','entregue','desconhecido'))
        +(select count(*) from outreach_messages where greeting_sent_at>=day_start)>=target then continue; end if;
      if b.kind='followup' and (select count(*) from commercial_outbox where kind='followup' and claimed_at>=day_start)>=o.daily_limit then continue; end if;
      if b.kind='initial' and (l.contacted or exists(select 1 from outreach_messages where phone_e164=any(outreach_phone_variants(b.phone_e164)) and greeting_sent_at is not null)
        or exists(select 1 from commercial_outbox where id<>b.id and phone_e164=any(outreach_phone_variants(b.phone_e164)) and status in ('enviada','entregue','desconhecido'))) then update commercial_outbox set status='cancelada',error='Contato já iniciado' where id=b.id; continue; end if;
    end if;
    update commercial_outbox set status='enviando',claimed_at=now(),attempts=1 where id=b.id;
    return jsonb_build_object('status','enviar','id',b.id,'etapa','comercial','telefone',b.phone_e164,'texto',b.body,'media',case when b.kind='video' then 'video' else 'texto' end,'asset',case when b.kind='video' then 'demo' end,'lead',l.business_name);
  end loop;
  return jsonb_build_object('status','fila_vazia');
end $$;
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
