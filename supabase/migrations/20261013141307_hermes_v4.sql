-- Evolução aditiva; nunca ativa a operação nem reescreve históricos antigos.
alter table public.leads add column business_address text check (length(business_address)<=500), add column booking_url text;
create index leads_address_city_idx on public.leads(city_norm,public.norm_text(business_address)) where business_address is not null;
create table public.commercial_settings (
  id integer primary key check (id = 1), enabled boolean not null default false,
  channel_authorized boolean not null default false, test_mode boolean not null default true,
  test_phones text[] not null default '{}', video_configured boolean not null default false,
  allowed_strategies text[] not null default array['A','B','C'], experiment_enabled boolean not null default true,
  experiment_size integer not null default 10 check (experiment_size between 1 and 100),
  max_messages integer not null default 15 check (max_messages between 1 and 50),
  last_worker_at timestamptz,last_sender_at timestamptz,
  bridge_connected boolean,bridge_state_changed_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.commercial_settings(id) values (1);
create table public.commercial_products (
  id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 1 and 100),
  scope text not null check (scope in ('landing_page_whatsapp','site_institucional','agendamento')),
  price numeric(12,2) not null check (price > 0), conditions text not null check (length(conditions) between 1 and 250),
  delivery_days integer check (delivery_days between 1 and 365), approved boolean not null default false
);
create unique index commercial_product_approved_scope on public.commercial_products(scope) where approved;
create table public.commercial_leads (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  stage text not null default 'PESQUISADO' check (stage in ('NOVO','PESQUISADO','QUALIFICADO','PRONTO_PARA_CONTATO','CONTATO_ENVIADO','RESPOSTA_RECEBIDA','TRIAGEM_RECEPCAO','AGUARDANDO_RESPONSAVEL','CONTATO_COM_DECISOR','APRESENTACAO_AUTORIZADA','VIDEO_ENVIADO','INTERESSE_IDENTIFICADO','QUALIFICACAO_COMERCIAL','PROPOSTA_SOLICITADA','PROPOSTA_ENVIADA','NEGOCIACAO','VENDA_FECHADA','PERDIDO','SEM_RESPOSTA','NAO_CONTATAR')),
  role text not null default 'UNKNOWN' check (role in ('UNKNOWN','AUTOMATED_ATTENDANT','RECEPTIONIST','SECRETARY','MANAGER','MARKETING_RESPONSIBLE','OWNER','DECISION_MAKER','AUTHORIZED_INTERMEDIARY')),
  role_confidence numeric not null default 0 check (role_confidence between 0 and 1), role_evidence text not null default '',
  eligible boolean not null default false, eligibility_reason text not null default '',
  strategy text check (strategy in ('A','B','C')), experiment boolean not null default false,
  score integer check (score between 0 and 100), data_confidence integer check (data_confidence between 0 and 100), score_details jsonb not null default '{}',
  video_offered boolean not null default false, video_authorized boolean not null default false, video_sent_at timestamptz,
  facts jsonb not null default '{}', followup_at timestamptz, followup_reason text,
  processed_reply uuid, revision integer not null default 0, updated_at timestamptz not null default now()
);
create table public.commercial_events (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade,
  from_stage text, to_stage text not null, reason text not null, source text not null default 'hermes',
  created_at timestamptz not null default now()
);
create index commercial_events_lead_idx on public.commercial_events(lead_id, created_at);
create table public.commercial_decisions (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade,
  reply_id uuid, intent text not null, objective text not null, reason text not null, action text not null,
  body text, state jsonb not null, created_at timestamptz not null default now()
);
create table public.commercial_outbox (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade,
  decision_id uuid references public.commercial_decisions(id) on delete cascade,
  idempotency_key text not null unique, kind text not null check (kind in ('initial','reply','video','followup','proposal')),
  body text not null check (length(body) between 1 and 700), phone_e164 text not null,
  status text not null default 'enfileirada' check (status in ('criada','enfileirada','enviando','enviada','entregue','falhou','desconhecido','cancelada')),
  provider_id text unique, attempts integer not null default 0 check (attempts between 0 and 1),
  due_at timestamptz not null default now(), claimed_at timestamptz, sent_at timestamptz, delivered_at timestamptz,
  error text, created_at timestamptz not null default now()
);
create index commercial_decisions_lead_idx on public.commercial_decisions(lead_id,created_at desc);
create index commercial_leads_activity_idx on public.commercial_leads(updated_at desc,lead_id);
create index commercial_outbox_ready_idx on public.commercial_outbox(due_at, created_at) where status = 'enfileirada';
create index commercial_outbox_lead_idx on public.commercial_outbox(lead_id, created_at);
create unique index commercial_outbox_video_uq on public.commercial_outbox(lead_id) where kind = 'video' and status <> 'cancelada';
create unique index commercial_outbox_initial_uq on public.commercial_outbox(lead_id) where kind='initial' and status<>'cancelada';
create table public.commercial_notifications (
  id uuid primary key default gen_random_uuid(), lead_id uuid references public.leads(id) on delete cascade,
  title text not null, detail text not null, read_at timestamptz, created_at timestamptz not null default now()
);
create index commercial_notifications_recent_idx on public.commercial_notifications(created_at desc);
alter table public.outreach_replies add column external_id text;
create unique index outreach_replies_external_idx on public.outreach_replies(external_id) where external_id is not null;

-- Admin somente; nenhum acesso público e nenhum mutador direto do navegador.
do $$ declare t text; begin
  foreach t in array array['commercial_settings','commercial_products','commercial_leads','commercial_events','commercial_decisions','commercial_outbox','commercial_notifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy admin_read on public.%I for select to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;

create function public.commercial_enroll() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin insert into commercial_leads(lead_id) values(new.id) on conflict do nothing; return null; end $$;
-- Executado após a definição do histórico abaixo.

create function public.commercial_history() returns trigger language plpgsql set search_path = public,pg_temp as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into commercial_events(lead_id,from_stage,to_stage,reason,source)
    values(new.lead_id, case when tg_op = 'UPDATE' then old.stage end, new.stage,
      coalesce(nullif(current_setting('app.commercial_reason',true),''),'Cadastro ou atualização comercial'),
      coalesce(nullif(current_setting('app.commercial_source',true),''),'hermes'));
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger commercial_history before insert or update on public.commercial_leads for each row execute function public.commercial_history();
insert into commercial_leads(lead_id) select id from leads on conflict do nothing;
create trigger commercial_enroll after insert on public.leads for each row execute function public.commercial_enroll();

create function public.admin_commercial_settings(p jsonb) returns void language plpgsql security definer set search_path = public,pg_temp as $$
declare s commercial_settings; phones text[]; strategies text[];
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into s from commercial_settings where id=1 for update;
  if coalesce((p->>'enabled')::boolean,s.enabled) and not s.enabled then
    if exists(select 1 from outreach_messages where status in ('enviando_saudacao','enviando_mensagem'))
      or exists(select 1 from outreach_secretary where status='enviando') or exists(select 1 from outreach_followups where status='enviando') then
      raise exception 'Aguarde o envio em andamento antes de mudar para V4.' using errcode='22023';
    end if;
    update outreach_messages set status='cancelada',cancelled_at=now(),cancel_reason='Motor V4 assumiu; histórico preservado' where status in ('pronta','saudacao_enviada');
    update outreach_secretary set status='cancelada',cancelled_at=now(),cancel_reason='Motor V4 assumiu' where status='pronta';
  end if;
  select coalesce(array_agg(distinct norm_phone(v)), '{}') into phones from jsonb_array_elements_text(coalesce(p->'test_phones',to_jsonb(s.test_phones))) v where norm_phone(v) is not null;
  select array_agg(v) into strategies from jsonb_array_elements_text(coalesce(p->'allowed_strategies',to_jsonb(s.allowed_strategies))) v;
  if strategies is null or not strategies <@ array['A','B','C'] then raise exception 'Estratégias inválidas' using errcode='22023'; end if;
  update commercial_settings set enabled=coalesce((p->>'enabled')::boolean,enabled),
    channel_authorized=coalesce((p->>'channel_authorized')::boolean,channel_authorized), test_mode=coalesce((p->>'test_mode')::boolean,test_mode),
    test_phones=phones, allowed_strategies=strategies, video_configured=coalesce((p->>'video_configured')::boolean,video_configured),
    experiment_enabled=coalesce((p->>'experiment_enabled')::boolean,experiment_enabled),
    max_messages=coalesce((p->>'max_messages')::integer,max_messages),updated_at=now() where id=1;
  -- Um único dono para a fila: V4 ativo suspende a seleção legada.
  if not coalesce((p->>'enabled')::boolean,s.enabled) then
    insert into commercial_notifications(title,detail) values('Operação V4 pausada','Nenhum novo envio V4 será reservado.');
  end if;
end $$;

create function public.admin_commercial_metrics() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare day_start timestamptz:=date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'; metrics jsonb; experiments jsonb; funnel jsonb;
begin
  perform require_admin();
  select jsonb_build_object(
    'encontrados_hoje',(select count(*) from leads where created_at>=day_start and origin='hermes'),
    'qualificados_hoje',(select count(distinct lead_id) from commercial_events where created_at>=day_start and to_stage='QUALIFICADO'),
    'contatados_hoje',(select count(distinct lead_id) from commercial_outbox where kind='initial' and sent_at>=day_start),
    'respostas_humanas',(select count(*) from outreach_replies where kind='humana' and received_at>=day_start),
    'respostas_automaticas',(select count(*) from outreach_replies where kind='automatica' and received_at>=day_start),
    'recepcionistas',(select count(*) from commercial_leads where role in ('RECEPTIONIST','SECRETARY')),
    'proprietarias',(select count(*) from commercial_leads where role='OWNER'),
    'apresentacoes',(select count(*) from commercial_leads where video_authorized),
    'videos',(select count(*) from commercial_leads where video_sent_at is not null),
    'interessados',(select count(*) from commercial_leads c where nullif(c.facts->>'interesse_confirmado','') is not null or exists(select 1 from commercial_events e where e.lead_id=c.lead_id and e.to_stage='INTERESSE_IDENTIFICADO')),
    'propostas_solicitadas',(select count(distinct lead_id) from commercial_events where to_stage='PROPOSTA_SOLICITADA'),
    'propostas_enviadas',(select count(distinct lead_id) from commercial_events where to_stage='PROPOSTA_ENVIADA'),
    'negociacoes',(select count(*) from commercial_leads where stage='NEGOCIACAO'),
    'vendas',(select count(*) from commercial_leads c join leads l on l.id=c.lead_id where l.stage='fechado'),
    'receita_confirmada',(select coalesce(sum(closed_value),0) from commercial_leads c join leads l on l.id=c.lead_id where l.stage='fechado'),
    'sem_resposta',(select count(*) from commercial_leads where stage='SEM_RESPOSTA'),
    'recusas',(select count(*) from commercial_leads where stage='NAO_CONTATAR'),
    'envios_desconhecidos',(select count(*) from commercial_outbox where status='desconhecido')) into metrics;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into experiments from (
    select c.strategy,count(*) as contatos,
      count(*) filter(where exists(select 1 from outreach_replies r where r.lead_id=c.lead_id and r.kind='humana')) as respostas_humanas,
      count(*) filter(where c.role in ('OWNER','MANAGER','MARKETING_RESPONSIBLE','DECISION_MAKER')) as decisores,
      count(*) filter(where c.video_authorized) as apresentacoes,
      count(*) filter(where nullif(c.facts->>'interesse_confirmado','') is not null or exists(select 1 from commercial_events e where e.lead_id=c.lead_id and e.to_stage='INTERESSE_IDENTIFICADO')) as interesses,
      count(*) filter(where exists(select 1 from commercial_events e where e.lead_id=c.lead_id and e.to_stage='PROPOSTA_ENVIADA')) as propostas,
      count(*) filter(where l.stage='fechado') as vendas
    from commercial_leads c join leads l on l.id=c.lead_id where c.experiment and exists(select 1 from commercial_outbox b where b.lead_id=c.lead_id and b.kind='initial' and b.sent_at is not null)
    group by c.strategy order by c.strategy) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into funnel from (select stage,count(*) as total from commercial_leads group by stage) x;
  return jsonb_build_object('metrics',metrics,'experiments',experiments,'funnel',funnel,'timezone','America/Sao_Paulo');
end $$;
revoke execute on function public.admin_commercial_metrics() from public,anon,authenticated;
grant execute on function public.admin_commercial_metrics() to authenticated;
create function public.admin_commercial_activate() returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s commercial_settings;
begin
  perform require_admin();perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into s from commercial_settings where id=1;
  if not s.enabled or not s.channel_authorized then raise exception 'Configure o motor V4 e a autorização do canal antes de ativar.' using errcode='22023'; end if;
  if s.test_mode and cardinality(s.test_phones)=0 then raise exception 'Informe os telefones controlados antes de ativar o teste.' using errcode='22023'; end if;
  if 'C'=any(s.allowed_strategies) and not s.video_configured then raise exception 'Configure o vídeo antes de usar a estratégia C.' using errcode='22023'; end if;
  if s.last_worker_at is null or s.last_worker_at<now()-interval '3 minutes' or s.last_sender_at is null or s.last_sender_at<now()-interval '3 minutes' or s.bridge_connected is distinct from true then raise exception 'Aguarde a conexão do Hermes e do enviador antes de ativar.' using errcode='22023'; end if;
  update outreach_settings set enabled=true,paused=false,today_new_leads_date=(now() at time zone 'America/Sao_Paulo')::date,
    today_new_leads_target=case when s.test_mode then 1 else least(daily_limit,5) end,updated_at=now(),updated_by=auth.uid() where id=1;
  insert into commercial_notifications(title,detail) values('Operação V4 ativada',case when s.test_mode then 'Teste controlado: um novo contato hoje.' else 'Configuração inicial: até cinco novos contatos hoje.' end);
end $$;
revoke execute on function public.admin_commercial_activate() from public,anon,authenticated;
grant execute on function public.admin_commercial_activate() to authenticated;
create function public.admin_commercial_product(p jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v uuid:=nullif(p->>'id','')::uuid; affected record;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  if v is null then
    insert into commercial_products(name,scope,price,conditions,delivery_days,approved)
    values(p->>'name',p->>'scope',(p->>'price')::numeric,p->>'conditions',nullif(p->>'delivery_days','')::integer,coalesce((p->>'approved')::boolean,false)) returning id into v;
  else
    if exists(select 1 from commercial_outbox b join commercial_decisions d on d.id=b.decision_id where b.status='enviando' and d.state->'facts'->>'quoted_product_id'=v::text) then raise exception 'Há preço ou proposta saindo; aguarde a confirmação.' using errcode='22023'; end if;
    update commercial_products set name=p->>'name',scope=p->>'scope',price=(p->>'price')::numeric,conditions=p->>'conditions',delivery_days=nullif(p->>'delivery_days','')::integer,approved=coalesce((p->>'approved')::boolean,false) where id=v;
    if not found then raise exception 'Produto não encontrado' using errcode='22023'; end if;
    for affected in select distinct b.lead_id from commercial_outbox b join commercial_decisions d on d.id=b.decision_id where b.status='enfileirada' and d.state->'facts'->>'quoted_product_id'=v::text loop
      update leads set secretary_handoff_at=now(),secretary_handoff_reason='Tabela mudou após preparação; revisar preço ou proposta' where id=affected.lead_id;
      insert into commercial_notifications(lead_id,title,detail) values(affected.lead_id,'Tabela comercial atualizada','Conversa com preço ou proposta pendente foi encaminhada para revisão.');
    end loop;
  end if;
  return v;
end $$;
create function public.admin_commercial_lead(p_lead uuid,p jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  if exists(select 1 from commercial_outbox where lead_id=p_lead and status='enviando') then raise exception 'Há mensagem saindo; aguarde a confirmação.' using errcode='22023'; end if;
  if coalesce((p->>'eligible')::boolean,false) and length(btrim(coalesce(p->>'eligibility_reason',''))) < 5 then raise exception 'Registre a base de elegibilidade e permissão do canal.' using errcode='22023'; end if;
  if p ? 'role' and p->>'role'<>'UNKNOWN' and length(btrim(coalesce(p->>'role_evidence','')))<3 then raise exception 'Registre a evidência do cargo confirmado.' using errcode='22023'; end if;
  perform set_config('app.commercial_reason',coalesce(p->>'reason','Correção administrativa'),true);
  perform set_config('app.commercial_source','manual',true);
  insert into commercial_leads(lead_id) values(p_lead) on conflict do nothing;
  update commercial_leads set eligible=coalesce((p->>'eligible')::boolean,eligible), eligibility_reason=coalesce(p->>'eligibility_reason',eligibility_reason),
    stage=coalesce(p->>'stage',stage),role=coalesce(p->>'role',role),
    role_evidence=coalesce(p->>'role_evidence',role_evidence), role_confidence=case when p->>'role'='UNKNOWN' then 0 when p ? 'role' then 1 else role_confidence end,
    followup_at=case when p ? 'followup_at' then nullif(p->>'followup_at','')::timestamptz else followup_at end,
    followup_reason=coalesce(p->>'followup_reason',followup_reason),
    processed_reply=case when exists(select 1 from commercial_outbox where lead_id=p_lead and status='enfileirada') then null else processed_reply end,
    revision=revision+1 where lead_id=p_lead;
  update commercial_outbox set status='cancelada',error='Contexto corrigido pelo administrador' where lead_id=p_lead and status='enfileirada';
  if (select stage from commercial_leads where lead_id=p_lead) in ('NAO_CONTATAR','PERDIDO','VENDA_FECHADA') then
    update commercial_leads set followup_at=null,followup_reason=null where lead_id=p_lead;
    if p->>'stage'='NAO_CONTATAR' then update leads set do_not_contact=true,do_not_contact_at=now() where id=p_lead; end if;
    if p->>'stage'='VENDA_FECHADA' and (select stage from leads where id=p_lead) <> 'fechado' then raise exception 'Registre primeiro o fechamento confirmado na ficha do lead.' using errcode='22023'; end if;
  end if;
end $$;

-- Contexto com versão, histórico e catálogo oficial. API decide; banco arbitra a gravação.
create function public.api_commercial_pending(p_token uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
    left join lateral(select id,kind from outreach_replies where lead_id=l.id order by (kind='humana') desc,received_at desc,id desc limit 1) r on true
    where cl.eligible and not l.do_not_contact and l.secretary_handoff_at is null
      and l.stage not in ('fechado','sem_interesse','desqualificado') and cl.stage not in ('NAO_CONTATAR','PERDIDO','VENDA_FECHADA')
      and (not s.test_mode or l.phone_e164=any(s.test_phones)) and l.phone_e164 is not null
      and not exists(select 1 from commercial_outbox b where b.lead_id=l.id and b.status in ('enfileirada','enviando','desconhecido'))
      and not exists(select 1 from outreach_secretary b where b.lead_id=l.id and b.status in ('pronta','enviando'))
      and not exists(select 1 from outreach_messages b where b.lead_id=l.id and b.status in ('pronta','enviando_saudacao','saudacao_enviada','enviando_mensagem'))
      and ((not l.contacted and l.stage='novo' and cl.stage in ('NOVO','PESQUISADO','QUALIFICADO','PRONTO_PARA_CONTATO') and not exists(select 1 from commercial_outbox b where b.lead_id=l.id and b.status<>'cancelada'))
        or (r.id is not null and r.id is distinct from cl.processed_reply))
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

create function public.api_commercial_save(p_token uuid,p_lead uuid,p_revision integer,p_reply uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c commercial_leads; l leads; s commercial_settings; did uuid; bid uuid; st jsonb:=p->'state'; k text; latest uuid;
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into c from commercial_leads where lead_id=p_lead for update;
  select * into l from leads where id=p_lead;
  select * into s from commercial_settings where id=1;
  select id into latest from outreach_replies where lead_id=p_lead order by (kind='humana') desc,received_at desc,id desc limit 1;
  if c.lead_id is null or c.revision <> p_revision or latest is distinct from p_reply then return jsonb_build_object('status','desatualizada'); end if;
  if not s.enabled or not s.channel_authorized or not c.eligible or l.secretary_handoff_at is not null or l.do_not_contact
     or not (select enabled and not paused from outreach_settings where id=1) then return jsonb_build_object('status','desligado'); end if;
  if p_reply is not null and p_reply=c.processed_reply then return jsonb_build_object('status','existente'); end if;
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
    k:=case when p_reply is null then 'initial' when p->>'action'='demonstration' then 'demo' when p->>'action'='video' then 'video' when p->>'intent'='proposta_preparada' then 'proposal' else 'reply' end;
    insert into commercial_outbox(lead_id,decision_id,idempotency_key,kind,body,phone_e164)
    values(p_lead,did,p_lead::text||':'||coalesce(p_reply::text,'initial')||':'||p_revision::text,k,p->>'body',l.phone_e164)
    on conflict do nothing returning id into bid;
  end if;
  return jsonb_build_object('status','registrado','id',bid,'decision_id',did);
end $$;

-- Envio V4 reserva uma vez. Timeout é desconhecido, nunca retentativa cega.
alter function public.api_register_candidate(uuid,text,jsonb,uuid) rename to api_register_candidate_legacy;
revoke execute on function public.api_register_candidate_legacy(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.api_register_candidate(p_token uuid,p_key text,p jsonb,p_run uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; v_score jsonb:=p->'commercial_score';
begin
  result:=api_register_candidate_legacy(p_token,p_key,p-'commercial_score',p_run);
  if result->>'status' in ('criado','existente') and not coalesce((result->>'replayed')::boolean,false) then
    update leads set business_address=coalesce(business_address,nullif(p->>'address','')),booking_url=coalesce(booking_url,nullif(p->>'booking_url','')) where id=(result->>'lead_id')::uuid;
  end if;
  if result->>'status' in ('criado','existente') and not coalesce((result->>'replayed')::boolean,false) and v_score is not null then
    update commercial_leads set score=(v_score->>'score')::integer,data_confidence=(v_score->>'confidence')::integer,score_details=v_score,
      stage=case when stage in ('NOVO','PESQUISADO','QUALIFICADO') then case when (v_score->>'score')::integer>=60 then 'QUALIFICADO' else 'PESQUISADO' end else stage end
      where lead_id=(result->>'lead_id')::uuid;
  end if;
  return result;
end $$;
revoke execute on function public.api_register_candidate(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.api_register_candidate(uuid,text,jsonb,uuid) to service_role;

alter function public.candidate_keys(jsonb) rename to candidate_keys_legacy;
create function public.candidate_keys(p jsonb) returns jsonb language sql stable set search_path=public,pg_temp as $$
  select candidate_keys_legacy(p)||jsonb_build_object('address',norm_text(p->>'address'))
$$;
alter function public.lock_candidate_keys(jsonb) rename to lock_candidate_keys_legacy;
create function public.lock_candidate_keys(k jsonb) returns void language plpgsql set search_path=public,pg_temp as $$
begin
  -- Todas as chamadas tomam primeiro a trava de endereço, depois as chaves legadas.
  if k->>'address' is not null then perform pg_advisory_xact_lock(hashtextextended('address:'||coalesce(k->>'city','')||':'||(k->>'address'),0)); end if;
  perform lock_candidate_keys_legacy(k);
end $$;
alter function public.find_lead_matches(jsonb) rename to find_lead_matches_legacy;
create function public.find_lead_matches(p jsonb) returns jsonb language plpgsql stable set search_path=public,pg_temp as $$
declare result jsonb:=find_lead_matches_legacy(p); k jsonb:=candidate_keys(p); ids uuid[]; exact_ids uuid[];
begin
  if k->>'address' is null or result->>'decision'='existente' or (result->>'decision'='revisao' and result->>'matched_on' <> 'nome_cidade') then return result; end if;
  select array_agg(id order by created_at) into ids from leads where city_norm=k->>'city' and norm_text(business_address)=k->>'address';
  if ids is null then return result; end if;
  select array_agg(id order by created_at) into exact_ids from leads where id=any(ids) and name_core=k->>'name_core' and unit_key=k->>'unit'
    and (instagram_handle is null or k->>'instagram' is null or instagram_handle=k->>'instagram');
  if cardinality(exact_ids)=1 then return jsonb_build_object('decision','existente','lead_id',exact_ids[1],'matched_on','nome_endereco','keys',k); end if;
  return jsonb_build_object('decision','revisao','reason','endereco_compartilhado','matched_on','endereco','matched_lead_ids',to_jsonb(ids),'keys',k);
end $$;
revoke execute on function public.candidate_keys(jsonb),public.lock_candidate_keys(jsonb),public.find_lead_matches(jsonb),public.candidate_keys_legacy(jsonb),public.lock_candidate_keys_legacy(jsonb),public.find_lead_matches_legacy(jsonb) from public,anon,authenticated;

alter function public.api_outreach_next(uuid) rename to api_outreach_next_legacy;
revoke execute on function public.api_outreach_next_legacy(uuid) from public,anon,authenticated,service_role;
create function public.api_outreach_next(p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
    where cl.followup_at<=now() and nullif(cl.followup_reason,'') is not null and cl.eligible
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

create function public.api_commercial_result(p_token uuid,p_id uuid,p_status text,p_provider text,p_error text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b commercial_outbox;
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select * into b from commercial_outbox where id=p_id for update;
  if b.id is null or p_status not in ('enviada','entregue','falhou','desconhecido') then return jsonb_build_object('status','invalido'); end if;
  if b.status in ('enviada','entregue') and p_status in ('enviada','falhou','desconhecido') then return jsonb_build_object('status','existente'); end if;
  if b.status not in ('enviando','desconhecido','enviada','entregue') then return jsonb_build_object('status','invalido'); end if;
  if b.provider_id is not null and p_provider is distinct from b.provider_id then return jsonb_build_object('status','invalido'); end if;
  if p_status in ('enviada','entregue') and nullif(p_provider,'') is null then return jsonb_build_object('status','invalido'); end if;
  update commercial_outbox set status=p_status,provider_id=coalesce(p_provider,provider_id),error=left(p_error,500),
    sent_at=case when p_status in ('enviada','entregue') then coalesce(sent_at,now()) else sent_at end,
    delivered_at=case when p_status='entregue' then coalesce(delivered_at,now()) else delivered_at end where id=p_id;
  if p_status in ('enviada','entregue') and b.sent_at is null then
    insert into contact_events(lead_id,occurred_at,channel,note,source) values(b.lead_id,now(),'whatsapp','Hermes V4: '||b.kind,'envio');
    if b.kind='initial' then
      update commercial_leads set stage='CONTATO_ENVIADO' where lead_id=b.lead_id;
      if (select stage from leads where id=b.lead_id)='novo' then perform set_stage(b.lead_id,'contatado','Hermes V4','envio'); end if;
    elsif b.kind='video' then update commercial_leads set stage='VIDEO_ENVIADO',video_sent_at=now() where lead_id=b.lead_id;
    elsif b.kind='proposal' then
      insert into proposals(lead_id,value,sent_at,note) select b.lead_id,(d.state->'facts'->>'proposta_valor')::numeric,now(),b.body from commercial_decisions d where id=b.decision_id;
      update commercial_leads set stage='PROPOSTA_ENVIADA' where lead_id=b.lead_id;
      perform set_stage(b.lead_id,'proposta_enviada','Proposta oficial enviada pelo Hermes V4','envio');
    end if;
    update outreach_settings set next_send_at=now()+make_interval(secs=>min_delay_seconds) where id=1;
  end if;
  if p_status in ('falhou','desconhecido') and b.status is distinct from p_status then insert into commercial_notifications(lead_id,title,detail) values(b.lead_id,'Envio '||p_status,'Verificar integração e resultado antes de agir.'); end if;
  return jsonb_build_object('status','registrado','message_status',p_status);
end $$;

create function public.api_commercial_health(p_token uuid,p_ready boolean) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous boolean;
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  select bridge_connected into previous from commercial_settings where id=1 for update;
  if previous is distinct from p_ready then
    update commercial_settings set bridge_connected=p_ready,bridge_state_changed_at=now() where id=1;
    if not p_ready then insert into commercial_notifications(title,detail) values('WhatsApp desconectado','Envios suspensos até a ponte se reconectar.'); end if;
  end if;
  return jsonb_build_object('status','registrado');
end $$;

-- Entrada V4 usa a tabela existente e ID do provedor. Legado permanece compatível.
alter function public.api_outreach_reply(uuid,jsonb) rename to api_outreach_reply_legacy;
revoke execute on function public.api_outreach_reply_legacy(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.api_outreach_reply(p_token uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l leads; rid uuid; result jsonb; ext text:=nullif(p->>'external_id','');
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  if ext is not null and exists(select 1 from outreach_replies where external_id=ext) then return jsonb_build_object('status','existente'); end if;
  select x.* into l from leads x join commercial_leads cl on cl.lead_id=x.id where x.phone_e164=any(outreach_phone_variants(p->>'phone_e164'))
    and exists(select 1 from commercial_outbox b where b.lead_id=x.id and b.status in ('enviada','entregue','desconhecido','enviando')) order by x.created_at limit 1;
  if l.id is null then
    result:=api_outreach_reply_legacy(p_token,p);
    if result->>'reply_id' is not null then update outreach_replies set external_id=ext where id=(result->>'reply_id')::uuid; end if;
    return result;
  end if;
  insert into outreach_replies(lead_id,phone_e164,body,received_at,kind,reason,opt_out,asks_price,media,external_id)
  values(l.id,l.phone_e164,left(p->>'body',4000),coalesce(nullif(p->>'received_at','')::timestamptz,now()),p->>'kind',left(p->>'reason',500),coalesce((p->>'opt_out')::boolean,false),coalesce((p->>'asks_price')::boolean,false),coalesce(p->>'media','texto'),ext)
  on conflict do nothing returning id into rid;
  if rid is null then return jsonb_build_object('status','existente'); end if;
  if coalesce((p->>'opt_out')::boolean,false) then
    update leads set do_not_contact=true,do_not_contact_at=now() where id=l.id;
    update commercial_leads set stage='NAO_CONTATAR',followup_at=null,followup_reason=null,revision=revision+1 where lead_id=l.id;
    update commercial_outbox set status='cancelada',error='Recusa recebida' where lead_id=l.id and status='enfileirada';
    insert into commercial_notifications(lead_id,title,detail) values(l.id,'Contato encerrado','Recusa recebida. Acompanhamentos cancelados.');
  elsif p->>'kind'='humana' then
    update commercial_leads set revision=revision+1,stage=case when stage in ('CONTATO_ENVIADO','SEM_RESPOSTA') then 'RESPOSTA_RECEBIDA' else stage end where lead_id=l.id;
    -- Não regredir negociação: o motor decide a próxima etapa.
    if l.stage in ('novo','contatado') then perform set_stage(l.id,'respondeu','Resposta humana ao Hermes V4','envio'); end if;
    update commercial_outbox set status='cancelada',error='Cliente escreveu novamente; reler histórico' where lead_id=l.id and status='enfileirada' and kind<>'initial';
  end if;
  return jsonb_build_object('status','registrada','reply_id',rid,'lead_id',l.id,'conversa',p->>'kind'='humana','kind',p->>'kind');
end $$;

-- Assumir no painel e escrever no celular cancelam a fila V4 na mesma transação.
create function public.commercial_manual_control() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.secretary_handoff_at is not null or new.do_not_contact or new.stage in ('fechado','sem_interesse','desqualificado') then
    update commercial_leads set followup_at=null,followup_reason=null,revision=revision+1,
      processed_reply=case when exists(select 1 from commercial_outbox where lead_id=new.id and status='enfileirada') then null else processed_reply end,
      stage=case when new.do_not_contact then 'NAO_CONTATAR' when new.stage='fechado' then 'VENDA_FECHADA' when new.stage in ('sem_interesse','desqualificado') then 'PERDIDO' else stage end where lead_id=new.id;
    update commercial_outbox set status='cancelada',error='Atendimento manual ou encerrado' where lead_id=new.id and status='enfileirada';
  end if;
  return null;
end $$;
create trigger commercial_manual_control after update of secretary_handoff_at,do_not_contact,stage on public.leads for each row execute function public.commercial_manual_control();
create function public.commercial_memory_changed() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  update commercial_leads set revision=revision+1,processed_reply=case when exists(select 1 from commercial_outbox where lead_id=new.lead_id and status='enfileirada') then null else processed_reply end where lead_id=new.lead_id;
  update commercial_outbox set status='cancelada',error='Memória alterada; reler contexto' where lead_id=new.lead_id and status='enfileirada';
  return null;
end $$;
create trigger commercial_memory_changed after insert or update on public.lead_conversation_memory for each row execute function public.commercial_memory_changed();
alter function public.admin_take_conversation(uuid) rename to admin_take_conversation_legacy;
revoke execute on function public.admin_take_conversation_legacy(uuid) from public,anon,authenticated,service_role;
create function public.admin_take_conversation(p_lead uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform require_admin(); perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  if exists(select 1 from commercial_outbox where lead_id=p_lead and status='enviando') then raise exception 'Há uma mensagem saindo agora. Aguarde a confirmação e tente novamente.' using errcode='22023'; end if;
  perform admin_take_conversation_legacy(p_lead);
end $$;
alter function public.admin_secretary_return(uuid) rename to admin_secretary_return_legacy;
revoke execute on function public.admin_secretary_return_legacy(uuid) from public,anon,authenticated,service_role;
create function public.admin_secretary_return(p_lead uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare last_in timestamptz;last_out timestamptz;
begin
  perform require_admin();perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  perform admin_secretary_return_legacy(p_lead);
  select max(received_at) into last_in from outreach_replies where lead_id=p_lead and kind='humana';
  select max(occurred_at) into last_out from conversation_timeline where lead_id=p_lead and direction='saida';
  if last_in>coalesce(last_out,'-infinity'::timestamptz) then update commercial_leads set processed_reply=null,revision=revision+1 where lead_id=p_lead; end if;
end $$;
revoke execute on function public.admin_secretary_return(uuid) from public,anon,authenticated;
grant execute on function public.admin_secretary_return(uuid) to authenticated;
alter function public.api_outreach_outbound(uuid,jsonb) rename to api_outreach_outbound_legacy;
revoke execute on function public.api_outreach_outbound_legacy(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.api_outreach_outbound(p_token uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l leads; v uuid;
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  select x.* into l from leads x join commercial_leads cl on cl.lead_id=x.id where x.phone_e164=any(outreach_phone_variants(p->>'phone_e164')) order by x.created_at limit 1;
  if l.id is null then return api_outreach_outbound_legacy(p_token,p); end if;
  insert into outreach_outbound(lead_id,phone_e164,sent_at,body,media,external_id)
  values(l.id,l.phone_e164,coalesce(nullif(p->>'sent_at','')::timestamptz,now()),p->>'body',coalesce(p->>'media','texto'),nullif(p->>'external_id','')) on conflict do nothing returning id into v;
  if v is null then return jsonb_build_object('status','existente'); end if;
  update leads set secretary_handoff_at=now(),secretary_handoff_reason='Marcos escreveu no celular' where id=l.id;
  return jsonb_build_object('status','registrada','lead_id',l.id);
end $$;

-- Incorpora V4 à linha do tempo existente; inbox recebe entradas V4 por outreach_replies.
create or replace view public.conversation_timeline with (security_invoker=true) as
select id::text||':saudacao' as id,lead_id,greeting_sent_at as occurred_at,'saida'::text as direction,'saudacao'::text as source,greeting as body,'texto'::text as media from outreach_messages where greeting_sent_at is not null
union all select id::text||':mensagem',lead_id,sent_at,'saida','abordagem',body,'texto' from outreach_messages where sent_at is not null
union all select id::text||':secretario',lead_id,sent_at,'saida','secretario',body,'texto' from outreach_secretary where status='enviada'
union all select id::text||':lembrete',lead_id,sent_at,'saida','lembrete',body,'texto' from outreach_followups where status='enviado'
union all select id::text||':cliente',lead_id,received_at,'entrada',kind,body,media from outreach_replies
union all select id::text||':manual',lead_id,sent_at,'saida','manual',body,media from outreach_outbound
union all select id::text||':v4',lead_id,sent_at,'saida','hermes_v4',body,case when kind='video' then 'video' else 'texto' end from commercial_outbox where sent_at is not null;

create or replace view public.conversation_inbox with (security_invoker=true) as
select l.id,l.business_name,l.city,l.stage,l.phone_e164,l.fit_score,l.secretary_handoff_at,l.secretary_handoff_reason,l.do_not_contact,
  r.received_at as last_in_at,r.body as last_in_body,r.media as last_in_media,
  greatest(m.sent_at,m.greeting_sent_at,sr.sent_at,fu.sent_at,manual.sent_at,v4.sent_at) as last_out_at,
  coalesce(pending.status,case q.status when 'enfileirada' then 'pronta' when 'enviando' then 'enviando' when 'falhou' then 'falhou' when 'desconhecido' then 'desconhecido' end) as pending_status,
  coalesce(pending.body,q.body) as pending_body,
  (not l.do_not_contact and l.stage not in ('fechado','sem_interesse','desqualificado') and l.secretary_handoff_at is null
   and pending.status is null and q.status is null and r.received_at is not null and r.received_at>coalesce(greatest(m.sent_at,m.greeting_sent_at,sr.sent_at,fu.sent_at,manual.sent_at,v4.sent_at),'-infinity'::timestamptz)) as needs_reply,
  greatest(r.received_at,m.sent_at,m.greeting_sent_at,sr.sent_at,fu.sent_at,manual.sent_at,v4.sent_at,l.secretary_handoff_at,l.created_at) as activity_at
from leads l
left join lateral(select received_at,body,media from outreach_replies where lead_id=l.id and kind='humana' order by received_at desc,id desc limit 1) r on true
left join lateral(select sent_at,greeting_sent_at from outreach_messages where lead_id=l.id order by greatest(sent_at,greeting_sent_at) desc nulls last limit 1) m on true
left join lateral(select sent_at from outreach_secretary where lead_id=l.id and status='enviada' order by sent_at desc limit 1) sr on true
left join lateral(select sent_at from outreach_followups where lead_id=l.id and status='enviado' order by sent_at desc limit 1) fu on true
left join lateral(select sent_at from outreach_outbound where lead_id=l.id order by sent_at desc limit 1) manual on true
left join lateral(select sent_at from commercial_outbox where lead_id=l.id and sent_at is not null order by sent_at desc limit 1) v4 on true
left join lateral(select status,body from outreach_secretary where lead_id=l.id and status in ('pronta','enviando','falhou') order by created_at desc limit 1) pending on true
left join lateral(select status,body from commercial_outbox where lead_id=l.id and status in ('enfileirada','enviando','falhou','desconhecido') order by created_at desc limit 1) q on true
where r.received_at is not null or l.secretary_handoff_at is not null;

-- Funções administrativas autorizadas explicitamente, RPCs apenas service role.
alter function public.api_secretary_pending(uuid,integer) rename to api_secretary_pending_legacy;
revoke execute on function public.api_secretary_pending_legacy(uuid,integer) from public,anon,authenticated,service_role;
create function public.api_secretary_pending(p_token uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  if (select enabled from commercial_settings where id=1) then return jsonb_build_object('status','desligado','conversas','[]'::jsonb); end if;
  return api_secretary_pending_legacy(p_token,p_limit);
end $$;
revoke execute on function public.api_secretary_pending(uuid,integer) from public,anon,authenticated;
grant execute on function public.api_secretary_pending(uuid,integer) to service_role;

alter function public.api_outreach_pending(uuid,integer) rename to api_outreach_pending_legacy;
revoke execute on function public.api_outreach_pending_legacy(uuid,integer) from public,anon,authenticated,service_role;
create function public.api_outreach_pending(p_token uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  if (select enabled from commercial_settings where id=1) then return jsonb_build_object('status','desligado','leads','[]'::jsonb); end if;
  return api_outreach_pending_legacy(p_token,p_limit);
end $$;
revoke execute on function public.api_outreach_pending(uuid,integer) from public,anon,authenticated;
grant execute on function public.api_outreach_pending(uuid,integer) to service_role;

alter function public.admin_save_conversation_memory(uuid,jsonb) rename to admin_save_conversation_memory_legacy;
revoke execute on function public.admin_save_conversation_memory_legacy(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.admin_save_conversation_memory(p_lead uuid,p jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform require_admin(); perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  if exists(select 1 from commercial_outbox where lead_id=p_lead and status='enviando') then raise exception 'Há mensagem saindo; aguarde para corrigir a memória.' using errcode='22023'; end if;
  perform admin_save_conversation_memory_legacy(p_lead,p);
end $$;
revoke execute on function public.admin_save_conversation_memory(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_save_conversation_memory(uuid,jsonb) to authenticated;

alter function public.api_get_settings(uuid) rename to api_get_settings_legacy;
revoke execute on function public.api_get_settings_legacy(uuid) from public,anon,authenticated,service_role;
create function public.api_get_settings(p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  return api_get_settings_legacy(p_token)||jsonb_build_object('commercial_v4',(select jsonb_build_object('enabled',enabled,'allowed_strategies',allowed_strategies) from commercial_settings where id=1));
end $$;
revoke execute on function public.api_get_settings(uuid) from public,anon,authenticated;
grant execute on function public.api_get_settings(uuid) to service_role;

do $$ declare f record; begin
  for f in select oid::regprocedure as signature,proname from pg_proc where pronamespace='public'::regnamespace and
    (proname like 'api_commercial_%' or proname in ('admin_commercial_settings','admin_commercial_product','admin_commercial_lead','api_outreach_next','api_outreach_reply','api_outreach_outbound','admin_take_conversation')) loop
    execute format('revoke execute on function %s from public,anon,authenticated,service_role',f.signature);
    execute format('grant execute on function %s to %I',f.signature,case when f.proname like 'admin_%' then 'authenticated' else 'service_role' end);
  end loop;
end $$;

