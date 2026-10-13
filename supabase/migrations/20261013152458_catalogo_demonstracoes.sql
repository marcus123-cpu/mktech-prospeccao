-- Biblioteca de mídia: servidor guarda metadados; ponte confirma acesso ao arquivo persistente.
create table public.commercial_demonstrations (
 id text primary key, config jsonb not null, available boolean not null default false, verified_at timestamptz
);
alter table public.commercial_demonstrations enable row level security;
create policy demo_admin_read on public.commercial_demonstrations for select to authenticated using ((select public.is_admin()));
revoke all on public.commercial_demonstrations from anon,authenticated;
grant select on public.commercial_demonstrations to authenticated;
grant all on public.commercial_demonstrations to service_role;
alter table public.commercial_outbox drop constraint commercial_outbox_kind_check;
alter table public.commercial_outbox add constraint commercial_outbox_kind_check check(kind in ('initial','reply','video','followup','proposal','demo'));
alter table public.commercial_outbox add column demonstration_id text references public.commercial_demonstrations(id);
create unique index commercial_demo_once on public.commercial_outbox(lead_id,demonstration_id) where kind='demo' and status<>'cancelada';
create table public.lead_demonstrations (
 lead_id uuid references public.leads(id) on delete cascade, demonstration_id text references public.commercial_demonstrations(id),
 recommended_at timestamptz not null default now(), offered_at timestamptz, authorized_at timestamptz,
 authorization_reply_id uuid references public.outreach_replies(id), sent_at timestamptz, client_response text, response_at timestamptz,
 primary key(lead_id,demonstration_id)
);
alter table public.lead_demonstrations enable row level security;
create policy lead_demo_admin_read on public.lead_demonstrations for select to authenticated using ((select public.is_admin()));
revoke all on public.lead_demonstrations from anon,authenticated;
grant select on public.lead_demonstrations to authenticated;
grant all on public.lead_demonstrations to service_role;

create function public.api_commercial_demo_health(p_token uuid,p_items jsonb,p_ready boolean) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
 update commercial_demonstrations d set available=p_ready and coalesce((x->>'available')::boolean,false),verified_at=now()
 from jsonb_array_elements(p_items) x where d.id=x->>'id';
 update commercial_demonstrations set available=false where config->>'kind'='video' and not exists(select 1 from jsonb_array_elements(p_items) x where x->>'id'=commercial_demonstrations.id);
 update commercial_settings set video_configured=exists(select 1 from commercial_demonstrations where config->>'kind'='video' and (config->>'approved')::boolean and available and verified_at>now()-interval '3 minutes') where id=1;
 return jsonb_build_object('status','registrado');
end $$;

alter function public.api_commercial_pending(uuid,integer) rename to api_commercial_pending_core;
create function public.api_commercial_pending(p_token uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; contexts jsonb; catalog jsonb;
begin
 r:=api_commercial_pending_core(p_token,p_limit);
 select coalesce(jsonb_agg(config||jsonb_build_object('available',available and (config->>'kind'='link' or verified_at>now()-interval '3 minutes'))),'[]') into catalog from commercial_demonstrations where (config->>'approved')::boolean;
 select coalesce(jsonb_agg(x||jsonb_build_object('demonstrations',catalog,'demonstration_history',
  coalesce((select jsonb_agg(jsonb_build_object('demonstration_id',b.demonstration_id,'status',b.status,'sent_at',b.sent_at)) from commercial_outbox b where b.lead_id=(x->>'lead_id')::uuid and b.kind='demo'),'[]'))),'[]')
 into contexts from jsonb_array_elements(coalesce(r->'contexts','[]')) x;
 return r||jsonb_build_object('contexts',contexts);
end $$;

alter function public.api_commercial_save(uuid,uuid,integer,uuid,jsonb) rename to api_commercial_save_core;
create function public.api_commercial_save(p_token uuid,p_lead uuid,p_revision integer,p_reply uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
   or exists(select 1 from commercial_outbox where lead_id=p_lead and demonstration_id=did and kind='demo' and status<>'cancelada') then return jsonb_build_object('status','invalido'); end if;
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

alter function public.api_outreach_next(uuid) rename to api_outreach_next_core;
create function public.api_outreach_next(p_token uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; b commercial_outbox; d commercial_demonstrations;
begin
 r:=api_outreach_next_core(p_token);
 if r->>'etapa'='comercial' and r->>'status'='enviar' then
  select * into b from commercial_outbox where id=(r->>'id')::uuid;
  if b.kind='demo' then
   select * into d from commercial_demonstrations where id=b.demonstration_id;
   if not d.available or not (d.config->>'approved')::boolean or (d.config->>'kind'='video' and (d.verified_at is null or d.verified_at<now()-interval '3 minutes')) then
    update commercial_outbox set status='cancelada',error='Demonstração indisponível antes do envio' where id=b.id;
    insert into commercial_notifications(lead_id,title,detail) values(b.lead_id,'Demonstração indisponível','Verificar biblioteca no serviço de envio.');
    return jsonb_build_object('status','fila_vazia');
   end if;
   if d.config->>'kind'='link' then update commercial_outbox set body=b.body||E'\n\n'||(d.config->>'url') where id=b.id; end if;
   r:=r||jsonb_build_object('asset',d.id,'media',case when d.config->>'kind'='video' then 'video' else 'texto' end);
  end if;
 end if;
 return r;
end $$;

alter function public.api_commercial_result(uuid,uuid,text,text,text) rename to api_commercial_result_core;
create function public.api_commercial_result(p_token uuid,p_id uuid,p_status text,p_provider text,p_error text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; b commercial_outbox;
begin
 r:=api_commercial_result_core(p_token,p_id,p_status,p_provider,p_error);
 select * into b from commercial_outbox where id=p_id;
 if r->>'status'='registrado' and b.sent_at is not null and b.demonstration_id is not null then
  if b.kind='demo' then
   update lead_demonstrations set sent_at=coalesce(sent_at,b.sent_at) where lead_id=b.lead_id and demonstration_id=b.demonstration_id;
   if (select config->>'kind' from commercial_demonstrations where id=b.demonstration_id)='video' then
    update commercial_leads set video_sent_at=coalesce(video_sent_at,b.sent_at),stage=case when stage='APRESENTACAO_AUTORIZADA' then 'VIDEO_ENVIADO' else stage end where lead_id=b.lead_id;
   end if;
  else update lead_demonstrations set offered_at=coalesce(offered_at,b.sent_at) where lead_id=b.lead_id and demonstration_id=b.demonstration_id; end if;
 end if;
 return r;
end $$;

alter function public.api_outreach_reply(uuid,jsonb) rename to api_outreach_reply_core;
create function public.api_outreach_reply(p_token uuid,p jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb;
begin
 r:=api_outreach_reply_core(p_token,p);
 if r->>'status'='registrada' and p->>'kind'='humana' then update lead_demonstrations set client_response=left(p->>'body',4000),response_at=now() where lead_id=(r->>'lead_id')::uuid and sent_at is not null; end if;
 return r;
end $$;

revoke execute on function public.api_commercial_pending_core(uuid,integer),public.api_commercial_save_core(uuid,uuid,integer,uuid,jsonb),public.api_outreach_next_core(uuid),public.api_commercial_result_core(uuid,uuid,text,text,text),public.api_outreach_reply_core(uuid,jsonb) from public,anon,authenticated,service_role;
revoke execute on function public.api_commercial_pending(uuid,integer),public.api_commercial_save(uuid,uuid,integer,uuid,jsonb),public.api_outreach_next(uuid),public.api_commercial_result(uuid,uuid,text,text,text),public.api_outreach_reply(uuid,jsonb),public.api_commercial_demo_health(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.api_commercial_pending(uuid,integer),public.api_commercial_save(uuid,uuid,integer,uuid,jsonb),public.api_outreach_next(uuid),public.api_commercial_result(uuid,uuid,text,text,text),public.api_outreach_reply(uuid,jsonb),public.api_commercial_demo_health(uuid,jsonb,boolean) to service_role;

create or replace view public.conversation_timeline with (security_invoker=true) as
select id::text||':saudacao' as id,lead_id,greeting_sent_at as occurred_at,'saida'::text as direction,'saudacao'::text as source,greeting as body,'texto'::text as media from outreach_messages where greeting_sent_at is not null
union all select id::text||':mensagem',lead_id,sent_at,'saida','abordagem',body,'texto' from outreach_messages where sent_at is not null
union all select id::text||':secretario',lead_id,sent_at,'saida','secretario',body,'texto' from outreach_secretary where status='enviada'
union all select id::text||':lembrete',lead_id,sent_at,'saida','lembrete',body,'texto' from outreach_followups where status='enviado'
union all select id::text||':cliente',lead_id,received_at,'entrada',kind,body,media from outreach_replies
union all select id::text||':manual',lead_id,sent_at,'saida','manual',body,media from outreach_outbound
union all select b.id::text||':v4',b.lead_id,b.sent_at,'saida','hermes_v4',b.body,case when b.kind='video' or (b.kind='demo' and (select config->>'kind' from commercial_demonstrations where id=b.demonstration_id)='video') then 'video' else 'texto' end from commercial_outbox b where b.sent_at is not null;




insert into public.commercial_demonstrations(id,config,available,verified_at) values ('DEMO_ROSANA_LANDING','{"id":"DEMO_ROSANA_LANDING","name":"Landing page da Rosana","category":"landing_page_portfolio","kind":"video","description":"Vídeo de uma landing page real da MKTech Dev para Rosana, massoterapeuta, apresentada no computador.","path":"landing-pages/rosana-landing-page.mp4","format":"video/mp4","available":true,"approved":true,"last_verified_at":"2026-10-13","recommended_niches":["estetica","bem-estar","servicos profissionais"],"scopes":["landing_page","landing_page_whatsapp","portfolio","clinica","landing_por_procedimento"],"match_terms":["landing page","portfolio","pagina de servicos","procedimentos"],"offer":"Tenho um exemplo real da MKTech Dev: a landing page da Rosana, uma profissional de bem-estar. O vídeo mostra a página no computador. Posso te enviar?","caption":"Este é o exemplo da landing page da Rosana. Ele mostra um trabalho já realizado; a proposta para sua empresa seria personalizada.","size_bytes":16811191,"duration_seconds":49.233333,"width":1440,"height":900,"video_codec":"h264","audio_codec":null,"sha256":"8d835abcabc68280eb3fcf5316374be939ec45d752f96bcf39fcacff42d22ab7","verified_features":["Apresentação da profissional","Navegação por seções visível no vídeo","Botões de contato WhatsApp visíveis"],"verification":{"original_preserved":true,"copy_hash_matches":true,"full_decode_ok":true,"browser_playback":"Playwright: duração 49,233s, 1440x900, 42 quadros decodificados, sem erro"},"send_history":"CRM: lead_demonstrations e commercial_outbox"}'::jsonb,false,null) on conflict(id) do update set config=excluded.config;
insert into public.commercial_demonstrations(id,config,available,verified_at) values ('DEMO_POLPUJA_VITRINE','{"id":"DEMO_POLPUJA_VITRINE","name":"Site da Polpujá","category":"site_vitrine_institucional","kind":"link","description":"Projeto real da MKTech Dev para apresentação da Polpujá e de seus produtos.","url":"https://www.xn--polpuj-uta.com.br/","format":"text/uri-list","available":true,"approved":true,"last_verified_at":"2026-10-13","recommended_niches":["produtos","comercio","empresas"],"scopes":["site_vitrine","site_institucional","produtos"],"match_terms":["site vitrine","site institucional","apresentacao de produtos","catalogo de produtos","vitrine","meus produtos","apresentar produtos","produtos"],"offer":"Tenho um exemplo real da MKTech Dev: o site da Polpujá, que apresenta a empresa e seus produtos. Posso te enviar o link?","caption":"Este é o exemplo do site da Polpujá. É um trabalho já realizado; o escopo para sua empresa seria definido conforme suas necessidades.","verified_features":["Apresentação da empresa observada no navegador","Navegação para catálogo de produtos funcionando","Página inicial e produtos sem transbordamento horizontal em viewport móvel"],"verification":{"http_status":200,"viewport_meta":true,"responsive_css":true,"visual_desktop_mobile":"verificado com Playwright: 998px e 390px","public_product_navigation":true,"visitor_session_status":401},"send_history":"CRM: lead_demonstrations e commercial_outbox"}'::jsonb,true,now()) on conflict(id) do update set config=excluded.config;
