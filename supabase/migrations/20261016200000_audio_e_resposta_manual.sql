-- Áudios das conversas (arquivo guardado no Storage) e respostas de texto enviadas pelo painel.

-- 1) Áudios -------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-audio', 'chat-audio', false, 16777216)
on conflict (id) do nothing;

create table public.chat_audio (
  external_id text primary key check (length(external_id) between 1 and 200),
  storage_path text not null,
  mime text not null,
  bytes integer not null check (bytes > 0),
  created_at timestamptz not null default now()
);
alter table public.chat_audio enable row level security;
revoke all on public.chat_audio from public, anon, authenticated;
grant select on public.chat_audio to authenticated;
grant all on public.chat_audio to service_role;
create policy admin_chat_audio on public.chat_audio for select to authenticated using (public.is_admin());

-- 2) Respostas manuais pelo painel -----------------------------------------------
create table public.manual_outbox (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  phone_e164 text not null,
  body text not null check (length(body) between 1 and 1000),
  status text not null default 'enfileirada' check (status in ('enfileirada','enviando','enviada','falhou')),
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);
create index manual_outbox_lead_idx on public.manual_outbox(lead_id, created_at desc);
create index manual_outbox_ready_idx on public.manual_outbox(created_at) where status = 'enfileirada';
alter table public.manual_outbox enable row level security;
revoke all on public.manual_outbox from public, anon, authenticated;
grant select on public.manual_outbox to authenticated;
grant all on public.manual_outbox to service_role;
create policy admin_manual_outbox on public.manual_outbox for select to authenticated using (public.is_admin());

-- Painel: enfileira a resposta e assume a conversa (o bot deixa de responder).
create function public.admin_send_manual_reply(p_lead uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare l leads; v_body text := btrim(coalesce(p_body, '')); v_id uuid;
begin
  perform require_admin();
  if length(v_body) = 0 or length(v_body) > 1000 then raise exception 'A mensagem deve ter de 1 a 1000 caracteres.' using errcode = '22023'; end if;
  select * into l from leads where id = p_lead;
  if not found or l.phone_e164 is null then raise exception 'Este lead não tem WhatsApp cadastrado.' using errcode = '22023'; end if;
  if l.do_not_contact then raise exception 'Este lead pediu para não ser contatado.' using errcode = '22023'; end if;
  if l.secretary_handoff_at is null then perform admin_take_conversation(p_lead); end if;
  insert into manual_outbox(lead_id, phone_e164, body) values (p_lead, l.phone_e164, v_body) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.admin_send_manual_reply(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_send_manual_reply(uuid, text) to authenticated;

-- Enviador: pega a próxima resposta manual (uma por vez, sem reenvio automático).
create function public.api_manual_next(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b manual_outbox;
begin
  if p_token is null then raise exception 'token inválido' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-manual', 0));
  update manual_outbox set status = 'falhou', error = 'Sem confirmação do envio; confira no WhatsApp antes de reenviar'
    where status = 'enviando' and claimed_at < now() - interval '5 minutes';
  if exists (select 1 from manual_outbox where status = 'enviando') then return jsonb_build_object('status', 'aguardar'); end if;
  select * into b from manual_outbox where status = 'enfileirada' order by created_at limit 1 for update skip locked;
  if not found then return jsonb_build_object('status', 'nenhum'); end if;
  update manual_outbox set status = 'enviando', claimed_at = now() where id = b.id;
  return jsonb_build_object('status', 'enviar', 'id', b.id, 'telefone', b.phone_e164, 'texto', b.body);
end $$;
revoke execute on function public.api_manual_next(uuid) from public, anon, authenticated;
grant execute on function public.api_manual_next(uuid) to service_role;

create function public.api_manual_result(p_token uuid, p_id uuid, p_ok boolean, p_provider text, p_error text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b manual_outbox;
begin
  if p_token is null then raise exception 'token inválido' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-manual', 0));
  select * into b from manual_outbox where id = p_id for update;
  if not found then return jsonb_build_object('status', 'invalido'); end if;
  if b.status = 'enviada' then return jsonb_build_object('status', 'existente'); end if;
  update manual_outbox set status = case when p_ok then 'enviada' else 'falhou' end,
    provider_id = nullif(left(p_provider, 200), ''), error = left(p_error, 500),
    sent_at = case when p_ok then now() else null end
  where id = p_id;
  return jsonb_build_object('status', 'registrado');
end $$;
revoke execute on function public.api_manual_result(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.api_manual_result(uuid, uuid, boolean, text, text) to service_role;

-- 3) Linha do tempo: expõe external_id (para achar o áudio) e inclui as respostas do painel.
create or replace view public.conversation_timeline with (security_invoker=true) as
select id::text||':saudacao' as id,lead_id,greeting_sent_at as occurred_at,'saida'::text as direction,'saudacao'::text as source,greeting as body,'texto'::text as media,null::text as external_id from outreach_messages where greeting_sent_at is not null
union all select id::text||':mensagem',lead_id,sent_at,'saida','abordagem',body,'texto',null from outreach_messages where sent_at is not null
union all select id::text||':secretario',lead_id,sent_at,'saida','secretario',body,'texto',null from outreach_secretary where status='enviada'
union all select id::text||':lembrete',lead_id,sent_at,'saida','lembrete',body,'texto',null from outreach_followups where status='enviado'
union all select id::text||':cliente',lead_id,received_at,'entrada',kind,body,media,external_id from outreach_replies
union all select id::text||':manual',lead_id,sent_at,'saida','manual',body,media,external_id from outreach_outbound
union all select b.id::text||':v4',b.lead_id,b.sent_at,'saida',case when b.simulated then 'simulacao' else 'hermes_v4' end,b.body,case when b.kind='video' or (b.kind='demo' and (select config->>'kind' from commercial_demonstrations where id=b.demonstration_id)='video') then 'video' else 'texto' end,null from commercial_outbox b where b.sent_at is not null
union all select h.external_id||':historico',h.lead_id,h.occurred_at,h.direction,
case when h.direction='saida' then 'historico_saida' else 'historico_entrada' end,h.body,h.media,h.external_id
from public.whatsapp_history h
where not exists(select 1 from public.outreach_replies r where r.external_id=h.external_id)
and not exists(select 1 from public.outreach_outbound o where o.external_id=h.external_id)
and not exists(select 1 from public.commercial_outbox c where c.provider_id=h.external_id)
and not exists(select 1 from public.manual_outbox m where m.provider_id=h.external_id)
union all select m.id::text||':painel',m.lead_id,coalesce(m.sent_at,m.created_at),'saida',case m.status when 'enviada' then 'painel' when 'falhou' then 'painel_falhou' else 'painel_pendente' end,m.body,'texto',null from manual_outbox m;
