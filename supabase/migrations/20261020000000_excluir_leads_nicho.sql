-- Exclusão simples de leads (vários de uma vez), de um nicho inteiro e dos que ficaram sem verificação de site.
-- Padrão seguro: leads com conversa ou mensagem enviada só saem quando você pede "tudo".
create or replace function public.lead_tem_historico(p_lead uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from whatsapp_history where lead_id = p_lead)
      or exists (select 1 from outreach_replies where lead_id = p_lead)
      or exists (select 1 from outreach_messages where lead_id = p_lead and greeting_sent_at is not null)
      or exists (select 1 from commercial_outbox where lead_id = p_lead and sent_at is not null)
      or exists (select 1 from manual_outbox where lead_id = p_lead)
      or exists (select 1 from leads where id = p_lead and (contacted or stage not in ('novo')));
$$;

create or replace function public.admin_delete_leads(p_leads uuid[]) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio', 0));
  with d as (delete from leads where id = any (p_leads) returning 1) select count(*) into n from d;
  return n;
end $$;
revoke all on function public.admin_delete_leads(uuid[]) from public, anon;
grant execute on function public.admin_delete_leads(uuid[]) to authenticated;

create or replace function public.admin_delete_niche(p_niche text, p_everything boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare apagados integer; mantidos integer;
begin
  perform require_admin();
  if nullif(btrim(p_niche), '') is null then raise exception 'Informe o nicho.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio', 0));
  with alvo as (
    select id from leads where coalesce(nullif(btrim(niche), ''), 'Sem nicho') = p_niche
      and (p_everything or not public.lead_tem_historico(id))
  ), d as (delete from leads where id in (select id from alvo) returning 1)
  select count(*) into apagados from d;
  select count(*) into mantidos from leads where coalesce(nullif(btrim(niche), ''), 'Sem nicho') = p_niche;
  return jsonb_build_object('apagados', apagados, 'mantidos', mantidos);
end $$;
revoke all on function public.admin_delete_niche(text, boolean) from public, anon;
grant execute on function public.admin_delete_niche(text, boolean) to authenticated;

create or replace function public.admin_delete_pending_leads() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare apagados integer;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio', 0));
  with d as (
    delete from leads where origin = 'hermes' and site_status = 'verificacao_pendente' and not public.lead_tem_historico(id) returning 1
  ) select count(*) into apagados from d;
  return jsonb_build_object('apagados', apagados);
end $$;
revoke all on function public.admin_delete_pending_leads() from public, anon;
grant execute on function public.admin_delete_pending_leads() to authenticated;
