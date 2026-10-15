-- Campanhas do Hermes autônomo: o administrador seleciona os leads, escolhe o
-- modo (simulação ou autônomo) e ativa/pausa/encerra. Sem aprovação individual
-- de mensagens; nenhum primeiro contato sai de lead fora de campanha ativa.
create table public.commercial_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  notes text check (length(notes) <= 500),
  mode text not null default 'simulacao' check (mode in ('simulacao','autonomo')),
  status text not null default 'rascunho' check (status in ('rascunho','ativa','pausada','encerrada')),
  created_by uuid, created_at timestamptz not null default now(),
  activated_at timestamptz, paused_at timestamptz, ended_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.commercial_campaign_leads (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  campaign_id uuid not null references public.commercial_campaigns(id) on delete cascade,
  added_at timestamptz not null default now(),
  baseline jsonb not null,
  baseline_memory jsonb
);
create index commercial_campaign_leads_campaign_idx on public.commercial_campaign_leads(campaign_id);
create table public.commercial_campaign_log (
  id bigint generated always as identity primary key,
  campaign_id uuid references public.commercial_campaigns(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  event text not null, detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index commercial_campaign_log_idx on public.commercial_campaign_log(campaign_id, id desc);
do $$ declare t text; begin
  foreach t in array array['commercial_campaigns','commercial_campaign_leads','commercial_campaign_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy admin_le on public.%I for select to authenticated using (public.is_admin())', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

alter table public.commercial_outbox add column simulated boolean not null default false;
alter table public.commercial_outbox drop constraint commercial_outbox_status_check;
alter table public.commercial_outbox add constraint commercial_outbox_status_check
  check (status in ('criada','enfileirada','enviando','enviada','entregue','falhou','desconhecido','cancelada','simulada'));
alter table public.outreach_replies add column simulated boolean not null default false;

-- Estado de campanha do lead: none | blocked (rascunho, pausada, encerrada) | simulacao | autonomo.
create function public.commercial_campaign_state(p_lead uuid) returns text
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select case when c.status='ativa' then c.mode else 'blocked' end
    from commercial_campaign_leads m join commercial_campaigns c on c.id=m.campaign_id where m.lead_id=p_lead),'none')
$$;
-- Primeiro contato exige campanha ativa. Conversas anteriores às campanhas
-- continuam atendidas; lead em campanha pausada/encerrada não é processado.
create function public.commercial_campaign_allows(p_lead uuid, p_first boolean) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select case when (select engine_version from commercial_settings where id=1)<>'v6' then true
    else case public.commercial_campaign_state(p_lead)
      when 'none' then not p_first when 'simulacao' then true when 'autonomo' then true else false end end
$$;
create function public.commercial_campaign_log_event(p_campaign uuid, p_lead uuid, p_event text, p_detail jsonb default '{}')
returns void language sql security definer set search_path=public,pg_temp as $$
  insert into commercial_campaign_log(campaign_id,lead_id,event,detail) values (p_campaign,p_lead,p_event,coalesce(p_detail,'{}'))
$$;
revoke execute on function public.commercial_campaign_state(uuid),public.commercial_campaign_allows(uuid,boolean),
  public.commercial_campaign_log_event(uuid,uuid,text,jsonb) from public,anon,authenticated;

-- Linha do tempo: mensagens simuladas aparecem identificadas.
create or replace view public.conversation_timeline with (security_invoker=true) as
select id::text||':saudacao' as id,lead_id,greeting_sent_at as occurred_at,'saida'::text as direction,'saudacao'::text as source,greeting as body,'texto'::text as media from outreach_messages where greeting_sent_at is not null
union all select id::text||':mensagem',lead_id,sent_at,'saida','abordagem',body,'texto' from outreach_messages where sent_at is not null
union all select id::text||':secretario',lead_id,sent_at,'saida','secretario',body,'texto' from outreach_secretary where status='enviada'
union all select id::text||':lembrete',lead_id,sent_at,'saida','lembrete',body,'texto' from outreach_followups where status='enviado'
union all select id::text||':cliente',lead_id,received_at,'entrada',kind,body,media from outreach_replies
union all select id::text||':manual',lead_id,sent_at,'saida','manual',body,media from outreach_outbound
union all select b.id::text||':v4',b.lead_id,b.sent_at,'saida',case when b.simulated then 'simulacao' else 'hermes_v4' end,b.body,case when b.kind='video' or (b.kind='demo' and (select config->>'kind' from commercial_demonstrations where id=b.demonstration_id)='video') then 'video' else 'texto' end from commercial_outbox b where b.sent_at is not null;

-- Portão de campanha na seleção de leads e no registro da decisão.
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
      and (not s.test_mode or l.phone_e164=any(s.test_phones) or public.commercial_campaign_state(l.id)='simulacao') and l.phone_e164 is not null
      and public.commercial_campaign_allows(l.id, not l.contacted and l.stage='novo')
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
declare cstate text; camp uuid; c commercial_leads; l leads; s commercial_settings; did uuid; bid uuid; st jsonb:=p->'state'; k text; latest uuid;
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into c from commercial_leads where lead_id=p_lead for update;
  select * into l from leads where id=p_lead;
  select * into s from commercial_settings where id=1;
  cstate:=public.commercial_campaign_state(p_lead);
  select id into latest from outreach_replies where lead_id=p_lead order by case when s.engine_version='v4' then (kind='humana')::integer else 0 end desc,received_at desc,id desc limit 1;
  if c.lead_id is null or c.revision <> p_revision or latest is distinct from p_reply then return jsonb_build_object('status','desatualizada'); end if;
  if not public.commercial_campaign_allows(p_lead, not l.contacted and l.stage='novo') then return jsonb_build_object('status','campanha_inativa'); end if;
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
    if cstate<>'simulacao' then update leads set secretary_handoff_at=now(),secretary_handoff_reason=left(p->>'reason',500) where id=p_lead; end if;
  elsif p->>'action'='stop' then
    if st->>'stage'='NAO_CONTATAR' and cstate<>'simulacao' then update leads set do_not_contact=true,do_not_contact_at=now() where id=p_lead; end if;
    update commercial_leads set followup_at=null,followup_reason=null where lead_id=p_lead;
    update commercial_outbox set status='cancelada' where lead_id=p_lead and status='enfileirada';
  elsif cstate='simulacao' and p->>'action' in ('text','video','demonstration') and nullif(p->>'body','') is not null then
    -- Simulação: a mensagem fica registrada como entregue ao teste e nunca entra na fila real.
    k:=case when p->>'intent'='followup_v6' then 'followup' when p_reply is null then 'initial' when p->>'action'='demonstration' then 'demo' when p->>'action'='video' then 'video' when p->>'intent'='proposta_preparada' then 'proposal' else 'reply' end;
    insert into commercial_outbox(lead_id,decision_id,idempotency_key,kind,body,phone_e164,status,sent_at,simulated)
    values(p_lead,did,p_lead::text||':'||coalesce(p_reply::text,'initial')||':'||p_revision::text,k,p->>'body',l.phone_e164,'simulada',now(),true)
    on conflict do nothing returning id into bid;
    if bid is not null then
      update commercial_leads set conversation_phase=case when k='initial' or p->>'intent'='greeting_v6' then 'WAITING_FIRST_REPLY' when k='demo' then 'DEMO_SENT' else conversation_phase end,
        commercial_memory=case when p->>'body' ilike '%assistente comercial da MKTech Dev%' then jsonb_set(commercial_memory,'{introduced}','true'::jsonb) else commercial_memory end where lead_id=p_lead;
    end if;
  elsif p->>'action' in ('text','video','demonstration') and nullif(p->>'body','') is not null then
    k:=case when p->>'intent'='followup_v6' then 'followup' when p_reply is null then 'initial' when p->>'action'='demonstration' then 'demo' when p->>'action'='video' then 'video' when p->>'intent'='proposta_preparada' then 'proposal' else 'reply' end;
    insert into commercial_outbox(lead_id,decision_id,idempotency_key,kind,body,phone_e164,test_run_id)
    values(p_lead,did,p_lead::text||':'||coalesce(p_reply::text,'initial')||':'||p_revision::text,k,p->>'body',l.phone_e164,c.active_test_run)
    on conflict do nothing returning id into bid;
  end if;
  select m.campaign_id into camp from commercial_campaign_leads m where m.lead_id=p_lead;
  if camp is not null then
    perform public.commercial_campaign_log_event(camp,p_lead,case when cstate='simulacao' then 'decisao_simulada' else 'decisao' end,
      jsonb_build_object('action',p->>'action','intent',p->>'intent','reason',left(p->>'reason',500),'body',left(p->>'body',700),'reply',p_reply is not null,'queued',bid is not null));
    if p->>'action'='stop' and st->>'stage'='NAO_CONTATAR' then
      perform public.commercial_campaign_log_event(camp,p_lead,case when cstate='simulacao' then 'bloqueio_simulado' else 'bloqueio_registrado' end,jsonb_build_object('reason',left(p->>'reason',500)));
    elsif p->>'action'='handoff' or p->>'intent'='handoff_v6_pending' then
      perform public.commercial_campaign_log_event(camp,p_lead,'intervencao_humana',jsonb_build_object('reason',left(p->>'reason',500),'simulated',cstate='simulacao'));
    elsif nullif(p->>'notification','') is not null then
      perform public.commercial_campaign_log_event(camp,p_lead,'aviso_equipe',jsonb_build_object('notification',left(p->>'notification',200),'simulated',cstate='simulacao'));
    end if;
  end if;
  return jsonb_build_object('status','registrado','id',bid,'decision_id',did);
end $$;

-- Contextos informam o modo da campanha; o prompt sabe que é um ensaio sem envio real.
alter function public.api_commercial_v6_contexts(uuid) rename to api_commercial_v6_contexts_before_campaign;
revoke execute on function public.api_commercial_v6_contexts_before_campaign(uuid) from public,anon,authenticated,service_role;
create function public.api_commercial_v6_contexts(p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; x jsonb; out jsonb:='[]'; mode text;
begin
  r:=api_commercial_v6_contexts_before_campaign(p_token);
  for x in select value from jsonb_array_elements(coalesce(r->'contexts','[]')) loop
    mode:=public.commercial_campaign_state((x->>'lead_id')::uuid);
    x:=x||jsonb_build_object('campaign_mode',mode);
    update commercial_leads set lease_context=lease_context||jsonb_build_object('campaign_mode',mode) where lead_id=(x->>'lead_id')::uuid and lease_id=(x->>'lease_id')::uuid;
    out:=out||jsonb_build_array(x);
  end loop;
  return case when r ? 'contexts' then r||jsonb_build_object('contexts',out) else r end;
end $$;
revoke execute on function public.api_commercial_v6_contexts(uuid) from public,anon,authenticated;
grant execute on function public.api_commercial_v6_contexts(uuid) to service_role;

-- Envio: pausa vale imediatamente. Mensagens de campanha pausada ficam retidas,
-- as de campanha encerrada ou de lead sem campanha são canceladas.
alter function public.api_outreach_next(uuid) rename to api_outreach_next_before_campaign;
revoke execute on function public.api_outreach_next_before_campaign(uuid) from public,anon,authenticated,service_role;
create function public.api_outreach_next(p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  update commercial_outbox b set status='cancelada',error='Campanha encerrada' where b.status='enfileirada'
    and exists(select 1 from commercial_campaign_leads m join commercial_campaigns c on c.id=m.campaign_id where m.lead_id=b.lead_id and c.status='encerrada');
  update commercial_outbox b set due_at=greatest(b.due_at,now()+interval '30 seconds') where b.status='enfileirada'
    and exists(select 1 from commercial_campaign_leads m join commercial_campaigns c on c.id=m.campaign_id where m.lead_id=b.lead_id and c.status in ('rascunho','pausada'));
  update commercial_outbox b set status='cancelada',error='Lead fora de campanha ativa' where b.status='enfileirada' and b.kind='initial'
    and not exists(select 1 from commercial_campaign_leads m where m.lead_id=b.lead_id)
    and (select engine_version from commercial_settings where id=1)='v6';
  update commercial_outbox b set status='cancelada',error='Mensagem simulada não pode ser enviada' where b.status='enfileirada' and b.simulated;
  return api_outreach_next_before_campaign(p_token);
end $$;
revoke execute on function public.api_outreach_next(uuid) from public,anon,authenticated;
grant execute on function public.api_outreach_next(uuid) to service_role;

-- ===== Administração =====
create function public.admin_campaign_create(p_name text, p_notes text default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare id uuid;
begin
  perform require_admin();
  if nullif(btrim(p_name),'') is null or length(btrim(p_name))>80 then raise exception 'Informe um nome de até 80 caracteres.' using errcode='22023'; end if;
  insert into commercial_campaigns(name,notes,created_by) values (btrim(p_name),nullif(btrim(p_notes),''),auth.uid()) returning commercial_campaigns.id into id;
  perform commercial_campaign_log_event(id,null,'criada',jsonb_build_object('name',btrim(p_name)));
  return id;
end $$;

create function public.admin_campaign_add_leads(p_campaign uuid, p_leads uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare camp commercial_campaigns; lid uuid; l leads; cl commercial_leads; added integer:=0; rejected jsonb:='[]'; why text; base jsonb; mem jsonb; prev_reason text;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into camp from commercial_campaigns where id=p_campaign for update;
  if camp.id is null then raise exception 'Campanha não encontrada.' using errcode='22023'; end if;
  if camp.status='encerrada' then raise exception 'Campanha encerrada não recebe leads.' using errcode='22023'; end if;
  for lid in select distinct x from unnest(coalesce(p_leads,'{}')) x loop
    why:=null;
    select * into l from leads where id=lid;
    select * into cl from commercial_leads where lead_id=lid for update;
    if l.id is null then why:='Lead não encontrado.';
    elsif l.do_not_contact then why:='Lead pediu para não ser contatado.';
    elsif l.phone_e164 is null then why:='Sem telefone válido.';
    elsif l.contacted or l.stage<>'novo' then why:='Lead já foi contatado ou saiu da etapa inicial.';
    elsif exists(select 1 from commercial_campaign_leads m where m.lead_id=lid) then why:='Lead já pertence a uma campanha.';
    elsif exists(select 1 from commercial_campaign_leads m join leads o on o.id=m.lead_id where o.id<>lid and o.phone_e164=any(outreach_phone_variants(l.phone_e164)))
      or exists(select 1 from leads o where o.id<>lid and o.contacted and o.phone_e164=any(outreach_phone_variants(l.phone_e164))) then why:='Telefone duplicado em outro lead já selecionado ou contatado.';
    end if;
    if why is null and not cl.eligible then
      prev_reason:=cl.eligibility_reason;
      if prev_reason='Retirado da fila pelo administrador' then update commercial_leads set eligibility_reason=null where lead_id=lid; end if;
      if not public.commercial_v6_enqueue_verified(lid) then
        if prev_reason='Retirado da fila pelo administrador' then update commercial_leads set eligibility_reason=prev_reason where lead_id=lid; end if;
        why:='Pesquisa insuficiente (telefone, WhatsApp público, fontes ou diagnóstico).';
      end if;
    end if;
    if why is null then
      select to_jsonb(c) into base from commercial_leads c where lead_id=lid;
      select to_jsonb(m) into mem from lead_conversation_memory m where lead_id=lid;
      insert into commercial_campaign_leads(lead_id,campaign_id,baseline,baseline_memory) values (lid,p_campaign,base,mem);
      added:=added+1;
      perform commercial_campaign_log_event(p_campaign,lid,'lead_adicionado','{}');
    else
      rejected:=rejected||jsonb_build_array(jsonb_build_object('lead_id',lid,'reason',why));
    end if;
  end loop;
  return jsonb_build_object('added',added,'rejected',rejected);
end $$;

create function public.admin_campaign_remove_lead(p_lead uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare m commercial_campaign_leads;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into m from commercial_campaign_leads where lead_id=p_lead;
  if m.lead_id is null then return; end if;
  if exists(select 1 from commercial_outbox where lead_id=p_lead and not simulated and status in ('enviando','enviada','entregue','desconhecido')) then
    raise exception 'Lead já foi contatado; pause ou encerre a campanha.' using errcode='22023';
  end if;
  update commercial_outbox set status='cancelada',error='Lead removido da campanha' where lead_id=p_lead and status='enfileirada';
  if exists(select 1 from commercial_campaigns where id=m.campaign_id and mode='simulacao') or exists(select 1 from commercial_outbox where lead_id=p_lead and simulated) then
    perform public.commercial_campaign_restore_lead(m);
  end if;
  delete from commercial_campaign_leads where lead_id=p_lead;
  perform commercial_campaign_log_event(m.campaign_id,p_lead,'lead_removido','{}');
end $$;

-- Restaura o lead ao estado anterior à simulação e apaga suas mensagens simuladas.
create function public.commercial_campaign_restore_lead(m commercial_campaign_leads) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare b commercial_leads;
begin
  delete from commercial_outbox where lead_id=m.lead_id and simulated;
  delete from outreach_replies where lead_id=m.lead_id and simulated;
  delete from commercial_decisions where lead_id=m.lead_id and created_at>=m.added_at;
  delete from commercial_notifications where lead_id=m.lead_id and created_at>=m.added_at;
  delete from lead_demonstrations where lead_id=m.lead_id;
  if m.baseline_memory is null then delete from lead_conversation_memory where lead_id=m.lead_id;
  else update lead_conversation_memory set summary=m.baseline_memory->>'summary',facts=m.baseline_memory->>'facts',objections=m.baseline_memory->>'objections',next_action=m.baseline_memory->>'next_action' where lead_id=m.lead_id; end if;
  select * into b from jsonb_populate_record(null::commercial_leads,m.baseline);
  perform set_config('app.commercial_reason','Reinício após simulação de campanha',true);
  update commercial_leads set stage=b.stage,role=b.role,role_confidence=b.role_confidence,role_evidence=b.role_evidence,strategy=b.strategy,experiment=b.experiment,
    score=b.score,data_confidence=b.data_confidence,score_details=b.score_details,video_offered=b.video_offered,video_authorized=b.video_authorized,video_sent_at=b.video_sent_at,
    facts=b.facts,followup_at=b.followup_at,followup_reason=b.followup_reason,processed_reply=b.processed_reply,conversation_phase=b.conversation_phase,readiness=b.readiness,
    commercial_memory=b.commercial_memory,recipient_timezone=b.recipient_timezone,inference_failures=0,retry_not_before=null,
    lease_id=null,lease_token=null,lease_until=null,lease_context=null,revision=revision+1 where lead_id=m.lead_id;
end $$;
revoke execute on function public.commercial_campaign_restore_lead(commercial_campaign_leads) from public,anon,authenticated;

create function public.admin_campaign_set_mode(p_campaign uuid, p_mode text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare camp commercial_campaigns; m commercial_campaign_leads;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into camp from commercial_campaigns where id=p_campaign for update;
  if camp.id is null then raise exception 'Campanha não encontrada.' using errcode='22023'; end if;
  if p_mode not in ('simulacao','autonomo') then raise exception 'Modo inválido.' using errcode='22023'; end if;
  if camp.status not in ('rascunho','pausada') then raise exception 'Pause a campanha antes de trocar o modo.' using errcode='22023'; end if;
  if p_mode=camp.mode then return; end if;
  if p_mode='autonomo' then
    -- Só libera o modo autônomo após uma simulação com saudação e resposta contextual.
    if not exists(select 1 from commercial_campaign_log where campaign_id=p_campaign and event='decisao_simulada' and detail->>'reply'='false')
      or not exists(select 1 from commercial_campaign_log where campaign_id=p_campaign and event='decisao_simulada' and detail->>'reply'='true') then
      raise exception 'Execute a simulação (saudação e pelo menos uma resposta) antes de liberar o modo autônomo.' using errcode='22023';
    end if;
    for m in select * from commercial_campaign_leads where campaign_id=p_campaign loop perform public.commercial_campaign_restore_lead(m); end loop;
  end if;
  update commercial_campaigns set mode=p_mode,updated_at=now() where id=p_campaign;
  perform commercial_campaign_log_event(p_campaign,null,'modo_alterado',jsonb_build_object('mode',p_mode));
end $$;

-- action: activate | pause | resume | end
create function public.admin_campaign_action(p_campaign uuid, p_action text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare camp commercial_campaigns; s commercial_settings;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into camp from commercial_campaigns where id=p_campaign for update;
  if camp.id is null then raise exception 'Campanha não encontrada.' using errcode='22023'; end if;
  select * into s from commercial_settings where id=1;
  if p_action in ('activate','resume') then
    if camp.status not in ('rascunho','pausada') or (p_action='activate' and camp.status<>'rascunho') or (p_action='resume' and camp.status<>'pausada') then
      raise exception 'Ação indisponível no estado atual da campanha.' using errcode='22023'; end if;
    if not exists(select 1 from commercial_campaign_leads where campaign_id=p_campaign) then raise exception 'Selecione ao menos um lead.' using errcode='22023'; end if;
    if s.engine_version<>'v6' then raise exception 'O motor V6 precisa estar ativo.' using errcode='22023'; end if;
    if camp.mode='autonomo' and not (s.enabled and s.channel_authorized) then
      raise exception 'Ative o Hermes e confirme o canal nas configurações antes do modo autônomo.' using errcode='22023'; end if;
    update commercial_campaigns set status='ativa',activated_at=coalesce(activated_at,now()),updated_at=now() where id=p_campaign;
  elsif p_action='pause' then
    if camp.status<>'ativa' then raise exception 'Campanha não está ativa.' using errcode='22023'; end if;
    update commercial_campaigns set status='pausada',paused_at=now(),updated_at=now() where id=p_campaign;
  elsif p_action='end' then
    if camp.status='encerrada' then return; end if;
    update commercial_campaigns set status='encerrada',ended_at=now(),updated_at=now() where id=p_campaign;
    update commercial_outbox set status='cancelada',error='Campanha encerrada'
      where status='enfileirada' and lead_id in (select lead_id from commercial_campaign_leads where campaign_id=p_campaign);
  else raise exception 'Ação inválida.' using errcode='22023';
  end if;
  perform commercial_campaign_log_event(p_campaign,null,'acao_'||p_action,jsonb_build_object('mode',camp.mode));
end $$;

-- Pausa de emergência: todas as campanhas ativas e o envio global.
create function public.admin_campaign_pause_all() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer; c uuid;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  update outreach_settings set paused=true where id=1;
  n:=0;
  for c in select id from commercial_campaigns where status='ativa' loop
    update commercial_campaigns set status='pausada',paused_at=now(),updated_at=now() where id=c;
    perform commercial_campaign_log_event(c,null,'pausa_geral','{}');
    n:=n+1;
  end loop;
  return n;
end $$;

-- Resposta de cliente fictício para testar a conversa sem mensagens reais.
create function public.admin_campaign_simulate_reply(p_lead uuid, p_body text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare m commercial_campaign_leads; l leads;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into m from commercial_campaign_leads where lead_id=p_lead;
  if m.lead_id is null or public.commercial_campaign_state(p_lead)<>'simulacao' then
    raise exception 'O lead precisa estar em uma campanha de simulação ativa.' using errcode='22023'; end if;
  if nullif(btrim(p_body),'') is null or length(p_body)>1000 then raise exception 'Escreva a resposta simulada (até 1000 caracteres).' using errcode='22023'; end if;
  select * into l from leads where id=p_lead;
  insert into outreach_replies(lead_id,phone_e164,body,received_at,kind,reason,simulated)
  values (p_lead,l.phone_e164,btrim(p_body),now(),'humana','Resposta simulada pelo administrador',true);
  perform commercial_campaign_log_event(m.campaign_id,p_lead,'resposta_simulada',jsonb_build_object('body',left(btrim(p_body),500)));
end $$;

-- Pedido real de não contato dentro de uma campanha fica no log da campanha.
create function public.commercial_campaign_optout_log() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare camp uuid;
begin
  select campaign_id into camp from commercial_campaign_leads where lead_id=new.id;
  if camp is not null then
    perform commercial_campaign_log_event(camp,new.id,'bloqueio_registrado',jsonb_build_object('source','lead'));
  end if;
  return null;
end $$;
create trigger commercial_campaign_optout_log after update of do_not_contact on public.leads
  for each row when (new.do_not_contact and not old.do_not_contact) execute function public.commercial_campaign_optout_log();
revoke execute on function public.commercial_campaign_optout_log() from public,anon,authenticated;

revoke execute on function public.admin_campaign_create(text,text),public.admin_campaign_add_leads(uuid,uuid[]),public.admin_campaign_remove_lead(uuid),
  public.admin_campaign_set_mode(uuid,text),public.admin_campaign_action(uuid,text),public.admin_campaign_pause_all(),public.admin_campaign_simulate_reply(uuid,text)
  from public,anon,service_role;
grant execute on function public.admin_campaign_create(text,text),public.admin_campaign_add_leads(uuid,uuid[]),public.admin_campaign_remove_lead(uuid),
  public.admin_campaign_set_mode(uuid,text),public.admin_campaign_action(uuid,text),public.admin_campaign_pause_all(),public.admin_campaign_simulate_reply(uuid,text)
  to authenticated;
