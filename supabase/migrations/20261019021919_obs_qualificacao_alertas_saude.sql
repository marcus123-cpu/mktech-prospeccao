-- A OBS de cada pesquisa só fica confirmada após revisão humana com evidência.
create table public.research_lead_reviews (
  run_id uuid not null references public.hermes_runs(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  verdict text not null check (verdict in ('confirmado','rejeitado')),
  evidence text not null check (length(btrim(evidence)) between 12 and 1000),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now(),
  primary key (run_id, lead_id)
);
alter table public.research_lead_reviews enable row level security;
revoke all on public.research_lead_reviews from public, anon, authenticated;
grant select on public.research_lead_reviews to authenticated;
grant all on public.research_lead_reviews to service_role;
create policy research_reviews_admin_read on public.research_lead_reviews for select to authenticated using ((select public.is_admin()));

create or replace function public.admin_review_research_lead(p_run uuid, p_lead uuid, p_verdict text, p_evidence text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.require_admin();
  if p_verdict not in ('confirmado','rejeitado') or length(btrim(coalesce(p_evidence,''))) not between 12 and 1000 then
    raise exception 'Informe a decisão e a evidência observada (12 a 1000 caracteres).' using errcode='22023';
  end if;
  if not exists (select 1 from public.hermes_requests r where r.run_id=p_run and nullif(btrim(r.observations),'') is not null) or
     not exists (select 1 from public.lead_evidences e where e.run_id=p_run and e.lead_id=p_lead) then
    raise exception 'Este lead não pertence à pesquisa com OBS.' using errcode='22023';
  end if;
  insert into public.research_lead_reviews(run_id,lead_id,verdict,evidence,reviewed_by)
  values(p_run,p_lead,p_verdict,btrim(p_evidence),auth.uid())
  on conflict(run_id,lead_id) do update set verdict=excluded.verdict,evidence=excluded.evidence,reviewed_by=excluded.reviewed_by,reviewed_at=now();
end $$;
revoke all on function public.admin_review_research_lead(uuid,uuid,text,text) from public,anon;
grant execute on function public.admin_review_research_lead(uuid,uuid,text,text) to authenticated;

create view public.research_run_leads with (security_invoker=true) as
select distinct e.run_id,e.lead_id,l.business_name,l.phone_e164,l.site_status,l.pending_items,
       coalesce(v.verdict,'pendente') as verdict,v.evidence,v.reviewed_at
from public.lead_evidences e
join public.hermes_requests r on r.run_id=e.run_id and nullif(btrim(r.observations),'') is not null
join public.leads l on l.id=e.lead_id
left join public.research_lead_reviews v on v.run_id=e.run_id and v.lead_id=e.lead_id;
revoke all on public.research_run_leads from public,anon;
grant select on public.research_run_leads to authenticated;

-- Erros administrativos persistem entre abas e dispositivos, sem guardar texto de mensagens ou telefones.
create table public.admin_alerts (
  id uuid primary key,
  user_id uuid not null,
  kind text not null check (kind in ('disparo')),
  message text not null check (length(message) between 1 and 2000),
  recovery text not null check (recovery in ('all','retry','review')),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context)='object'),
  created_at timestamptz not null default now(),
  dismissed_at timestamptz
);
create index admin_alerts_open_idx on public.admin_alerts(user_id,created_at desc) where dismissed_at is null;
alter table public.admin_alerts enable row level security;
revoke all on public.admin_alerts from public,anon,authenticated;
grant select,insert,update on public.admin_alerts to authenticated;
create policy admin_alerts_select on public.admin_alerts for select to authenticated using (user_id=(select auth.uid()) and (select public.is_admin()));
create policy admin_alerts_insert on public.admin_alerts for insert to authenticated with check (user_id=(select auth.uid()) and (select public.is_admin()));
create policy admin_alerts_update on public.admin_alerts for update to authenticated using (user_id=(select auth.uid()) and (select public.is_admin())) with check (user_id=(select auth.uid()) and (select public.is_admin()));
grant all on public.admin_alerts to service_role;

-- Proteção no banco: seleção manual e automática respeitam a OBS.
-- Lead de disparo encerrado/cancelado volta a ficar livre: só campanha ativa ou pausada segura o lead.
create or replace function public.admin_campaign_add_leads(p_campaign uuid, p_leads uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare camp commercial_campaigns; lid uuid; l leads; cl commercial_leads; added integer:=0; rejected jsonb:='[]'; rejected_total integer:=0; why text; base jsonb; mem jsonb;
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
    elsif exists(select 1 from public.research_run_leads q where q.lead_id=lid and q.verdict<>'confirmado') then why:='OBS da pesquisa ainda não confirmada ou rejeitada.';
    elsif exists(select 1 from commercial_campaign_leads m join commercial_campaigns k on k.id=m.campaign_id where m.lead_id=lid and k.status<>'encerrada') then why:='Lead já pertence a uma campanha em andamento.';
    elsif exists(select 1 from commercial_campaign_leads m join commercial_campaigns k on k.id=m.campaign_id and k.status<>'encerrada' join leads o on o.id=m.lead_id where o.id<>lid and o.phone_e164=any(outreach_phone_variants(l.phone_e164)))
      or exists(select 1 from leads o where o.id<>lid and o.contacted and o.phone_e164=any(outreach_phone_variants(l.phone_e164))) then why:='Telefone duplicado em outro lead já selecionado ou contatado.';
    end if;
    -- Telefone fixo não recebe WhatsApp: a campanha não tem como contatar.
    if why is null and l.phone_e164 !~ '^\+55[0-9]{2}9[0-9]{8}$' then why:='Telefone fixo ou sem WhatsApp provável.'; end if;
    -- A seleção do administrador autoriza o lead. A prontidão da pesquisa (identidade, serviços, diagnóstico
    -- e fontes) continua sendo conferida pelo Hermes antes da saudação: sem ela, ele espera e mostra o motivo.
    if why is null and not cl.eligible then
      update commercial_leads set eligible=true,
        eligibility_reason='Selecionado pelo administrador em campanha; prontidão da pesquisa conferida antes da saudação.'
        where lead_id=lid;
    end if;
    if why is null then
      select to_jsonb(c) into base from commercial_leads c where lead_id=lid;
      select to_jsonb(m) into mem from lead_conversation_memory m where lead_id=lid;
      delete from commercial_campaign_leads where lead_id=lid; -- sai da campanha encerrada
      insert into commercial_campaign_leads(lead_id,campaign_id,baseline,baseline_memory) values (lid,p_campaign,base,mem);
      added:=added+1;
      perform commercial_campaign_log_event(p_campaign,lid,'lead_adicionado','{}');
    else
      rejected_total:=rejected_total+1;
      if jsonb_array_length(rejected)<50 then rejected:=rejected||jsonb_build_array(jsonb_build_object('lead_id',lid,'reason',why)); end if;
    end if;
  end loop;
  return jsonb_build_object('added',added,'rejected',rejected,'rejected_total',rejected_total);
end $$;


create or replace function public.dispatch_available_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select l.id from leads l
  where l.stage = 'novo' and not l.contacted and not l.do_not_contact and l.phone_e164 ~ '^\+55[0-9]{2}9[0-9]{8}$'
    and not exists (select 1 from public.research_run_leads q where q.lead_id=l.id and q.verdict<>'confirmado')
    and not exists (select 1 from commercial_campaign_leads m join commercial_campaigns k on k.id = m.campaign_id
                    where m.lead_id = l.id and k.status <> 'encerrada')
$$;
