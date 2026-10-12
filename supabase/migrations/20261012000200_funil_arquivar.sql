-- Funil: o Marcos tira do funil os atendimentos que não quer mais ver.
-- Não apaga nada: o lead ganha funnel_archived_at, vai para a seção
-- "Arquivados" do funil e pode voltar com um clique. Não bloqueia contato
-- (para isso existe "não contatar" na ficha do lead).

alter table public.leads add column funnel_archived_at timestamptz;

create or replace view public.outreach_funnel
with (security_invoker = true) as
  select l.id, l.business_name, l.city, l.stage, l.fit_score, l.phone_e164, l.price_question_at,
         l.do_not_contact, o.status as message_status, o.greeting_sent_at, o.sent_at, o.created_at as message_created_at,
         r.received_at as last_reply_at, r.body as last_reply, r.kind as last_reply_kind,
         exists (select 1 from public.outreach_replies a where a.lead_id = l.id and a.media = 'audio') as sent_audio,
         case
           when l.funnel_archived_at is not null then 'arquivado'
           when l.stage = 'fechado' then 'fechado'
           when l.stage in ('respondeu', 'interessado', 'proposta_enviada') and l.followup_closed_at is not null then 'sem_retorno'
           when l.stage in ('respondeu', 'interessado', 'proposta_enviada') and coalesce(fu.n, 0) > 0 then 'lembrando'
           when l.stage = 'proposta_enviada' then 'fechando'
           when l.stage in ('sem_interesse', 'desqualificado') or l.do_not_contact then 'encerrado'
           when l.price_question_at is not null then 'valor'
           when l.stage in ('respondeu', 'interessado') then 'conversa'
           when o.no_reply_at is not null and o.sent_at is null then 'sem_resposta'
           when o.status = 'saudacao_enviada' and o.sent_at is null and o.held_at is not null then 'aguardando'
           when o.status in ('saudacao_enviada', 'enviando_mensagem', 'enviada') then 'enviado'
           when o.status in ('pronta', 'enviando_saudacao') then 'fila'
           when o.status = 'falhou' then 'atencao'
         end as coluna,
         greatest(l.updated_at, o.created_at, o.greeting_sent_at, o.sent_at, r.received_at, o.held_at, o.no_reply_at, l.followup_closed_at) as movido_em,
         l.funnel_archived_at
  from public.leads l
  left join lateral (
    select * from public.outreach_messages x where x.lead_id = l.id and x.status <> 'cancelada'
    order by x.created_at desc limit 1
  ) o on true
  left join lateral (
    select count(*) as n from public.outreach_followups u
    where u.lead_id = l.id and u.status = 'enviado'
      and u.reply_ref is not distinct from (
        select max(h.received_at) from public.outreach_replies h where h.lead_id = l.id and h.kind = 'humana' and not h.opt_out)
  ) fu on true
  left join lateral (
    select * from public.outreach_replies y where y.lead_id = l.id order by y.received_at desc limit 1
  ) r on true
  where o.id is not null or l.stage in ('respondeu', 'interessado', 'proposta_enviada', 'fechado');

create or replace function public.admin_funnel_archive(p_lead uuid, p_archived boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update leads set funnel_archived_at = case when p_archived then now() else null end where id = p_lead;
end
$$;
revoke execute on function public.admin_funnel_archive(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_funnel_archive(uuid, boolean) to authenticated;
