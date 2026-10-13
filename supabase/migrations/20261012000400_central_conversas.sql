-- Central de atendimento e memória factual, editada pelo administrador.
-- Nenhuma função desta migration envia mensagens.
create table public.lead_conversation_memory (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  summary text not null default '' check (length(summary) <= 2000),
  facts text not null default '' check (length(facts) <= 3000),
  objections text not null default '' check (length(objections) <= 2000),
  next_action text not null default '' check (length(next_action) <= 1000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.lead_conversation_memory enable row level security;
revoke all on public.lead_conversation_memory from anon, authenticated;
grant select on public.lead_conversation_memory to authenticated;
grant all on public.lead_conversation_memory to service_role;
create policy admin_le on public.lead_conversation_memory for select to authenticated using (public.is_admin());

create or replace function public.admin_save_conversation_memory(p_lead uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if not exists (select 1 from leads where id = p_lead) then
    raise exception 'lead não encontrado' using errcode = '22023';
  end if;
  -- A resposta pronta pode ter sido escrita antes destas novas orientações.
  perform pg_advisory_xact_lock(hashtextextended('mktech-secretario', 0));
  insert into lead_conversation_memory (lead_id, summary, facts, objections, next_action, updated_by)
  values (p_lead, coalesce(p->>'summary', ''), coalesce(p->>'facts', ''),
    coalesce(p->>'objections', ''), coalesce(p->>'next_action', ''), auth.uid())
  on conflict (lead_id) do update set summary = excluded.summary, facts = excluded.facts,
    objections = excluded.objections, next_action = excluded.next_action, updated_at = now(), updated_by = auth.uid();
  update outreach_secretary set status = 'cancelada', cancelled_at = now(),
    cancel_reason = 'memória atualizada pelo Marcos; leia o contexto novamente'
  where lead_id = p_lead and status = 'pronta';
end $$;
revoke execute on function public.admin_save_conversation_memory(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_save_conversation_memory(uuid, jsonb) to authenticated;

-- Assumir é explícito e cancela imediatamente respostas ainda não reservadas.
create or replace function public.admin_take_conversation(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  -- Mesma ordem de travas do enviador: não disputa uma reserva em andamento.
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio', 0));
  perform pg_advisory_xact_lock(hashtextextended('mktech-secretario', 0));
  if exists (select 1 from outreach_secretary where lead_id = p_lead and status = 'enviando')
     or exists (select 1 from outreach_messages where lead_id = p_lead and status in ('enviando_saudacao', 'enviando_mensagem'))
     or exists (select 1 from outreach_followups where lead_id = p_lead and status = 'enviando') then
    raise exception 'Há uma mensagem saindo agora. Aguarde a confirmação e tente novamente.' using errcode = '22023';
  end if;
  update leads set secretary_handoff_at = now(), secretary_handoff_reason = 'você assumiu pela central de conversas'
  where id = p_lead;
  if not found then raise exception 'lead não encontrado' using errcode = '22023'; end if;
  update outreach_secretary set status = 'cancelada', cancelled_at = now(), cancel_reason = 'você assumiu o atendimento'
  where lead_id = p_lead and status = 'pronta';
end $$;
revoke execute on function public.admin_take_conversation(uuid) from public, anon, authenticated;
grant execute on function public.admin_take_conversation(uuid) to authenticated;

-- Índices para buscar só o último evento de cada cliente.
create index outreach_replies_human_latest_idx on public.outreach_replies(lead_id, received_at desc)
  where kind = 'humana';
create index outreach_secretary_sent_latest_idx on public.outreach_secretary(lead_id, sent_at desc)
  where status = 'enviada';

create view public.conversation_inbox with (security_invoker = true) as
select l.id, l.business_name, l.city, l.stage, l.phone_e164, l.fit_score,
  l.secretary_handoff_at, l.secretary_handoff_reason, l.do_not_contact,
  r.received_at as last_in_at, r.body as last_in_body, r.media as last_in_media,
  greatest(m.sent_at, m.greeting_sent_at, sr.sent_at, fu.sent_at, manual.sent_at) as last_out_at,
  pending.status as pending_status, pending.body as pending_body,
  (not l.do_not_contact and l.stage not in ('fechado', 'sem_interesse', 'desqualificado')
    and l.secretary_handoff_at is null and pending.status is null
    and r.received_at is not null and r.received_at > coalesce(
      greatest(m.sent_at, m.greeting_sent_at, sr.sent_at, fu.sent_at, manual.sent_at), '-infinity'::timestamptz)) as needs_reply,
  greatest(r.received_at, m.sent_at, m.greeting_sent_at, sr.sent_at, fu.sent_at, manual.sent_at,
    l.secretary_handoff_at, l.created_at) as activity_at
from public.leads l
left join lateral (select received_at, body, media from public.outreach_replies
  where lead_id = l.id and kind = 'humana' order by received_at desc, id desc limit 1) r on true
left join lateral (select sent_at, greeting_sent_at from public.outreach_messages
  where lead_id = l.id order by greatest(sent_at, greeting_sent_at) desc nulls last limit 1) m on true
left join lateral (select sent_at from public.outreach_secretary
  where lead_id = l.id and status = 'enviada' order by sent_at desc limit 1) sr on true
left join lateral (select sent_at from public.outreach_followups
  where lead_id = l.id and status = 'enviado' order by sent_at desc limit 1) fu on true
left join lateral (select sent_at from public.outreach_outbound
  where lead_id = l.id order by sent_at desc limit 1) manual on true
left join lateral (select status, body from public.outreach_secretary
  where lead_id = l.id and status in ('pronta', 'enviando', 'falhou') order by created_at desc limit 1) pending on true
where r.received_at is not null or l.secretary_handoff_at is not null;
revoke all on public.conversation_inbox from anon, authenticated;
grant select on public.conversation_inbox to authenticated;

-- Histórico único: só textos efetivamente enviados. Mensagem manual tem apenas
-- horário registrado pela ponte, nunca texto inventado.
create view public.conversation_timeline with (security_invoker = true) as
select id::text || ':saudacao' as id, lead_id, greeting_sent_at as occurred_at,
  'saida'::text as direction, 'saudacao'::text as source, greeting as body, 'texto'::text as media
from public.outreach_messages where greeting_sent_at is not null
union all select id::text || ':mensagem', lead_id, sent_at, 'saida', 'abordagem', body, 'texto'
from public.outreach_messages where sent_at is not null
union all select id::text || ':secretario', lead_id, sent_at, 'saida', 'secretario', body, 'texto'
from public.outreach_secretary where status = 'enviada'
union all select id::text || ':lembrete', lead_id, sent_at, 'saida', 'lembrete', body, 'texto'
from public.outreach_followups where status = 'enviado'
union all select id::text || ':cliente', lead_id, received_at, 'entrada', kind, body, media
from public.outreach_replies
union all select id::text || ':manual', lead_id, sent_at, 'saida', 'manual', null, 'texto'
from public.outreach_outbound;
revoke all on public.conversation_timeline from anon, authenticated;
grant select on public.conversation_timeline to authenticated;

-- Preserva o contrato e todas as travas da API existente. Acrescenta memória
-- factual e uma referência para impedir salvar resposta com memória antiga.
alter function public.api_secretary_pending(uuid, integer) rename to api_secretary_pending_v1;
revoke execute on function public.api_secretary_pending_v1(uuid, integer) from public, anon, authenticated, service_role;
create function public.api_secretary_pending(p_token uuid, p_limit integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb; conversations jsonb;
begin
  result := api_secretary_pending_v1(p_token, p_limit);
  select coalesce(jsonb_agg(c || jsonb_build_object('memory', coalesce(to_jsonb(mem) - 'updated_by', '{}'::jsonb),
      'memory_ref', mem.updated_at)), '[]'::jsonb) into conversations
  from jsonb_array_elements(result->'conversas') c
  left join lead_conversation_memory mem on mem.lead_id = (c->>'lead_id')::uuid;
  return jsonb_set(result, '{conversas}', conversations);
end $$;
revoke execute on function public.api_secretary_pending(uuid, integer) from public, anon, authenticated;
grant execute on function public.api_secretary_pending(uuid, integer) to service_role;

alter function public.api_secretary_save(uuid, uuid, jsonb) rename to api_secretary_save_v1;
revoke execute on function public.api_secretary_save_v1(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
create function public.api_secretary_save(p_token uuid, p_lead uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare memory_at timestamptz;
begin
  if p_token is null then raise exception 'token inválido' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-secretario', 0));
  select updated_at into memory_at from lead_conversation_memory where lead_id = p_lead;
  if memory_at is distinct from nullif(p->>'memory_ref', '')::timestamptz then
    return jsonb_build_object('status', 'desatualizada', 'motivo', 'a memória mudou; leia o contexto novamente');
  end if;
  return api_secretary_save_v1(p_token, p_lead, p);
end $$;
revoke execute on function public.api_secretary_save(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.api_secretary_save(uuid, uuid, jsonb) to service_role;
