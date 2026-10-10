-- Lembretes para quem conversou com a gente e parou de responder.
-- Sem apagar nada: até 2 lembretes curtos, cada um 2 dias úteis depois de a
-- última mensagem ser NOSSA (a do Marcos ou um lembrete) sem resposta. Depois
-- do segundo e mais 2 dias úteis, o lead é encerrado e nada mais é enviado.
-- Resposta do cliente em qualquer momento zera tudo e devolve a conversa ao
-- Marcos. Tem chave própria (followups_enabled), desligada por padrão.

alter table public.outreach_settings add column followups_enabled boolean not null default false;
alter table public.leads add column followup_closed_at timestamptz;

-- Mensagens que o Marcos escreveu à mão no celular do chip (só o horário).
create table public.outreach_outbound (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  phone_e164 text not null,
  sent_at timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index outreach_outbound_uq on public.outreach_outbound (phone_e164, sent_at);
create index outreach_outbound_lead_idx on public.outreach_outbound (lead_id, sent_at desc);

create table public.outreach_followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  n smallint not null check (n in (1, 2)),
  reply_ref timestamptz,
  status text not null check (status in ('enviando', 'enviado', 'falhou')),
  body text not null check (length(body) between 1 and 300),
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  error text check (length(error) <= 500),
  created_at timestamptz not null default now()
);
-- Um lembrete de cada número por resposta do cliente; falha também gasta a vaga.
create unique index outreach_followups_uq on public.outreach_followups (lead_id, n, coalesce(reply_ref, 'epoch'::timestamptz));

alter table public.outreach_outbound enable row level security;
alter table public.outreach_followups enable row level security;
revoke all on public.outreach_outbound, public.outreach_followups from anon, authenticated;
grant select on public.outreach_outbound, public.outreach_followups to authenticated;
create policy admin_le on public.outreach_outbound for select to authenticated using (public.is_admin());
create policy admin_le on public.outreach_followups for select to authenticated using (public.is_admin());
grant all on public.outreach_outbound, public.outreach_followups to service_role;

-- Fila de lembretes: conversou (pessoa respondeu), o último a falar foi nosso
-- e ninguém bloqueou. sent_since = lembretes já gastos desde a última resposta.
create or replace function public.outreach_followup_state() returns table (
  lead_id uuid, phone_e164 text, business_name text, last_in timestamptz, last_out timestamptz,
  last_f timestamptz, sent_since integer)
language sql stable
set search_path = public
as $$
  select z.lead_id, z.phone_e164, z.business_name, z.last_in, greatest(z.out_mk, z.last_f), z.last_f, z.sent_since
  from (
    select b.lead_id, b.phone_e164, b.business_name, b.last_in, b.out_mk,
           (select max(u.sent_at) from outreach_followups u
             where u.lead_id = b.lead_id and u.status = 'enviado' and u.reply_ref is not distinct from b.last_in) as last_f,
           (select count(*)::integer from outreach_followups u
             where u.lead_id = b.lead_id and u.reply_ref is not distinct from b.last_in) as sent_since
    from (
      select l.id as lead_id, l.phone_e164, l.business_name,
             (select max(r.received_at) from outreach_replies r
               where r.lead_id = l.id and r.kind = 'humana' and not r.opt_out) as last_in,
             (select max(o.sent_at) from outreach_outbound o where o.lead_id = l.id) as out_mk
      from leads l
      where l.stage in ('respondeu', 'interessado', 'proposta_enviada')
        and not l.do_not_contact and l.followup_closed_at is null and l.phone_e164 is not null
        and exists (select 1 from outreach_messages m
                     where m.lead_id = l.id and m.greeting_sent_at is not null and m.status <> 'cancelada')
    ) b
    where b.last_in is not null
  ) z
  where greatest(z.out_mk, z.last_f) > z.last_in
    -- lembrete que falhou encerra os lembretes desse ciclo: nada é reenviado nem substituído
    and not exists (select 1 from outreach_followups u
                     where u.lead_id = z.lead_id and u.status = 'falhou' and u.reply_ref is not distinct from z.last_in)
$$;
revoke execute on function public.outreach_followup_state() from public, anon, authenticated;

-- Enviador: o Marcos escreveu à mão para esse telefone (só guarda o horário).
create or replace function public.api_outreach_outbound(p_token uuid, p jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phones text[] := outreach_phone_variants(p ->> 'phone_e164');
  v_at timestamptz := coalesce(nullif(p ->> 'sent_at', '')::timestamptz, now());
  m outreach_messages;
  v_id uuid;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  select * into m from outreach_messages
  where phone_e164 = any (v_phones) and greeting_sent_at is not null
  order by greeting_sent_at desc limit 1;
  if not found then
    return jsonb_build_object('status', 'ignorada', 'motivo', 'telefone não recebeu abordagem automática');
  end if;
  insert into outreach_outbound (lead_id, phone_e164, sent_at) values (m.lead_id, m.phone_e164, v_at)
  on conflict do nothing returning id into v_id;
  if v_id is null then
    return jsonb_build_object('status', 'existente', 'lead_id', m.lead_id);
  end if;
  return jsonb_build_object('status', 'registrada', 'lead_id', m.lead_id);
end
$$;

-- Painel: liga e desliga os lembretes (separado da chave geral).
create or replace function public.admin_outreach_followups(p_enabled boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update outreach_settings set followups_enabled = p_enabled, updated_at = now(), updated_by = auth.uid() where id = 1;
end
$$;
revoke execute on function public.admin_outreach_followups(boolean) from public, anon, authenticated;
grant execute on function public.admin_outreach_followups(boolean) to authenticated;
revoke execute on function public.api_outreach_outbound(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.api_outreach_outbound(uuid, jsonb) to service_role;

create or replace function public.api_outreach_reply(p_token uuid, p jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phones text[] := outreach_phone_variants(p ->> 'phone_e164');
  v_kind text := p ->> 'kind';
  v_opt boolean := coalesce((p ->> 'opt_out')::boolean, false);
  v_price boolean := coalesce((p ->> 'asks_price')::boolean, false) and (p ->> 'kind') = 'humana';
  v_at timestamptz := coalesce(nullif(p ->> 'received_at', '')::timestamptz, now());
  v_media text := coalesce(nullif(p ->> 'media', ''), 'texto');
  m outreach_messages;
  v_id uuid;
  v_stage lead_stage;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if v_kind not in ('automatica', 'humana') or v_media not in ('texto', 'audio', 'imagem', 'outro') then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('kind ou media inválido'));
  end if;
  select * into m from outreach_messages
  where phone_e164 = any (v_phones) and greeting_sent_at is not null
  order by greeting_sent_at desc limit 1;
  if not found then
    return jsonb_build_object('status', 'ignorada', 'motivo', 'telefone não recebeu abordagem automática');
  end if;

  insert into outreach_replies (lead_id, message_id, phone_e164, body, received_at, kind, reason, opt_out, asks_price, media)
  values (m.lead_id, m.id, m.phone_e164, left(p ->> 'body', 4000), v_at, v_kind, left(p ->> 'reason', 500), v_opt, v_price, v_media)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('status', 'existente', 'lead_id', m.lead_id);
  end if;

  if v_opt then
    update leads set do_not_contact = true, do_not_contact_at = now() where id = m.lead_id;
    update outreach_messages set status = 'cancelada', cancelled_at = now(),
      cancel_reason = 'lead pediu para não receber mensagens'
    where id = m.id and status in ('pronta', 'saudacao_enviada');
  end if;
  if v_kind = 'automatica' and not v_opt then
    -- Texto personalizado ainda não saiu: segura até uma pessoa escrever.
    update outreach_messages set held_at = coalesce(held_at, v_at), held_reason = left(p ->> 'reason', 500)
    where id = m.id and status = 'saudacao_enviada' and sent_at is null and no_reply_at is null;
  end if;
  if v_kind = 'humana' then
    -- Pessoa escreveu: libera o texto segurado, com uma pausa curta.
    update outreach_messages set held_at = null, held_reason = null, no_reply_at = null,
      body_due_at = now() + interval '45 seconds'
    where id = m.id and status = 'saudacao_enviada' and sent_at is null;
    update leads set followup_closed_at = null where id = m.lead_id and followup_closed_at is not null;
    select stage into v_stage from leads where id = m.lead_id;
    if v_stage in ('novo', 'contatado') then
      perform set_stage(m.lead_id, 'respondeu', 'respondeu à abordagem automática', 'envio');
    end if;
    if v_price then
      update leads set price_question_at = coalesce(price_question_at, v_at) where id = m.lead_id;
    end if;
  end if;
  return jsonb_build_object('status', 'registrada', 'reply_id', v_id, 'lead_id', m.lead_id, 'kind', v_kind,
    'conversa', v_kind = 'humana', 'opt_out', v_opt, 'pergunta_valor', v_price, 'audio', v_media = 'audio',
    'segurada', v_kind = 'automatica' and not v_opt);
end
$$;

create or replace function public.api_outreach_next(p_token uuid) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s outreach_settings;
  v_local timestamp := now() at time zone 'America/Sao_Paulo';
  v_day_start timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  m outreach_messages;
  l leads;
  v_sent integer;
  v_greeting text;
  f record;
  v_fid uuid;
  v_text text;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio', 0));
  select * into s from outreach_settings where id = 1 for update;

  -- Etapa sem confirmação em 5 minutos: falhou e não é reenviada.
  for m in select * from outreach_messages
           where status in ('enviando_saudacao', 'enviando_mensagem') and claimed_at < now() - interval '5 minutes' loop
    update outreach_messages
    set status = 'falhou', failed_at = now(), timed_out = true,
        error = 'o enviador não confirmou em 5 minutos; não foi reenviada'
    where id = m.id;
  end loop;

  -- Lembrete sem confirmação em 5 minutos: falhou e não é reenviado.
  update outreach_followups set status = 'falhou', failed_at = now(),
    error = 'o enviador não confirmou em 5 minutos; não foi reenviado'
  where status = 'enviando' and claimed_at < now() - interval '5 minutes';

  -- Dois lembretes sem resposta e mais 2 dias úteis de espera: encerra o lead.
  update leads set followup_closed_at = now()
  where followup_closed_at is null and exists (select 1 from outreach_followup_state() z
    where z.lead_id = leads.id and z.sent_since >= 2 and z.last_f is not null
      and outreach_add_business_days(z.last_f, 2) <= now());

  -- Segurada há mais de 2 dias úteis sem pessoa responder: Sem resposta.
  update outreach_messages m2 set no_reply_at = now()
  where m2.status = 'saudacao_enviada' and m2.sent_at is null and m2.no_reply_at is null
    and not exists (select 1 from outreach_replies r where r.message_id = m2.id and r.kind = 'humana')
    and outreach_add_business_days(m2.greeting_sent_at, 2) <= now();

  if not s.enabled then
    return jsonb_build_object('status', 'desligado');
  end if;
  if s.paused then
    return jsonb_build_object('status', 'pausado');
  end if;

  -- Uma etapa por vez: se algo está saindo agora, espera.
  if exists (select 1 from outreach_messages where status in ('enviando_saudacao', 'enviando_mensagem'))
     or exists (select 1 from outreach_followups where status = 'enviando') then
    return jsonb_build_object('status', 'aguardar', 'segundos', 15, 'motivo', 'etapa em andamento');
  end if;

  -- 1) Mensagem principal de quem já recebeu a saudação (menos as seguradas).
  for m in select * from outreach_messages
           where status = 'saudacao_enviada' and no_reply_at is null
             and exists (select 1 from outreach_replies r where r.message_id = outreach_messages.id and r.kind = 'humana')
           order by body_due_at loop
    select * into l from leads where id = m.lead_id;
    if l.do_not_contact then
      update outreach_messages set status = 'cancelada', cancelled_at = now(),
        cancel_reason = 'lead pediu para não receber mensagens' where id = m.id;
      continue;
    end if;
    if m.body_due_at > now() then
      return jsonb_build_object('status', 'aguardar', 'motivo', 'intervalo depois da saudação',
        'segundos', greatest(1, ceil(extract(epoch from m.body_due_at - now()))::int));
    end if;
    update outreach_messages set status = 'enviando_mensagem', step = 'mensagem', claimed_at = now(), timed_out = false
    where id = m.id;
    return jsonb_build_object('status', 'enviar', 'id', m.id, 'etapa', 'mensagem', 'telefone', m.phone_e164,
      'texto', m.body, 'lead', l.business_name);
  end loop;

  -- 2) Saudação de um lead novo: horário, dias, limite diário e espera.
  if not (extract(isodow from v_local)::smallint = any (s.send_days))
     or extract(hour from v_local) < s.window_start
     or extract(hour from v_local) >= s.window_end then
    return jsonb_build_object('status', 'fora_do_horario');
  end if;
  select (select count(*) from outreach_messages where greeting_sent_at >= v_day_start)
       + (select count(*) from outreach_followups where claimed_at >= v_day_start) into v_sent;
  if v_sent >= s.daily_limit then
    return jsonb_build_object('status', 'limite_diario', 'enviadas_hoje', v_sent);
  end if;
  if s.next_send_at is not null and s.next_send_at > now() then
    return jsonb_build_object('status', 'aguardar', 'motivo', 'tempo de segurança entre leads',
      'segundos', greatest(1, ceil(extract(epoch from s.next_send_at - now()))::int));
  end if;

  -- 2b) Lembrete para quem conversou e parou de responder (chave própria).
  if s.followups_enabled then
    select z.* into f from outreach_followup_state() z
    where z.sent_since < 2 and outreach_add_business_days(z.last_out, 2) <= now()
    order by z.last_out limit 1;
    if found then
      v_text := case when f.sent_since = 0 then 'Oi! Você gostou da minha proposta?'
                     else 'Oi, você viu minha mensagem? Fico à disposição, sem compromisso.' end;
      insert into outreach_followups (lead_id, n, reply_ref, status, body, claimed_at)
      values (f.lead_id, f.sent_since + 1, f.last_in, 'enviando', v_text, now())
      returning id into v_fid;
      return jsonb_build_object('status', 'enviar', 'id', v_fid, 'etapa', 'lembrete', 'telefone', f.phone_e164,
        'texto', v_text, 'lead', f.business_name);
    end if;
  end if;

  -- Tira da fila quem deixou de estar apto (contatado à mão, bloqueado...).
  for m in select o.* from outreach_messages o join leads x on x.id = o.lead_id
           where o.status = 'pronta' and not outreach_lead_ok(x) loop
    update outreach_messages set status = 'cancelada', cancelled_at = now(),
      cancel_reason = 'lead deixou de estar apto (etapa, contato, bloqueio ou telefone já abordado)'
    where id = m.id;
  end loop;

  select o.* into m from outreach_messages o
  where o.status = 'pronta'
  order by o.created_at
  limit 1;
  if not found then
    return jsonb_build_object('status', 'fila_vazia');
  end if;
  select * into l from leads where id = m.lead_id;
  v_greeting := outreach_greeting(v_local, l.responsible_name);
  update outreach_messages
  set status = 'enviando_saudacao', step = 'saudacao', claimed_at = now(), greeting = v_greeting,
      phone_e164 = l.phone_e164, timed_out = false
  where id = m.id;
  return jsonb_build_object('status', 'enviar', 'id', m.id, 'etapa', 'saudacao', 'telefone', l.phone_e164,
    'texto', v_greeting, 'lead', l.business_name);
end
$$;

create or replace function public.api_outreach_result(p_token uuid, p_id uuid, p_step text, p_ok boolean, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m outreach_messages;
  fu outreach_followups;
  s outreach_settings;
  v_expected text := case p_step when 'saudacao' then 'enviando_saudacao' when 'mensagem' then 'enviando_mensagem' end;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if p_step = 'lembrete' then
    select * into fu from outreach_followups where id = p_id for update;
    if not found then
      return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('lembrete não encontrado'));
    end if;
    if fu.status = 'enviado' and p_ok then
      return jsonb_build_object('status', 'existente', 'id', fu.id);
    end if;
    if fu.status not in ('enviando', 'falhou') then
      return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('etapa não corresponde ao estado do lembrete'));
    end if;
    select * into s from outreach_settings where id = 1 for update;
    if p_ok then
      update outreach_followups set status = 'enviado', sent_at = now(), error = null, failed_at = null where id = p_id;
      insert into contact_events (lead_id, occurred_at, channel, note, source)
      values (fu.lead_id, now(), 'whatsapp', 'Lembrete automático ' || fu.n || ' enviado', 'envio');
      update outreach_settings set next_send_at = now() + make_interval(secs => s.min_delay_seconds
        + floor(random() * (s.max_delay_seconds - s.min_delay_seconds + 1))) where id = 1;
      return jsonb_build_object('status', 'registrado', 'id', p_id, 'message_status', 'enviado');
    end if;
    update outreach_followups set status = 'falhou', failed_at = now(),
      error = left(coalesce(nullif(btrim(p_error), ''), 'falha no envio'), 500) where id = p_id;
    update outreach_settings set next_send_at = now() + make_interval(secs => s.min_delay_seconds) where id = 1;
    return jsonb_build_object('status', 'registrado', 'id', p_id, 'message_status', 'falhou');
  end if;
  if v_expected is null then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('etapa deve ser saudacao, mensagem ou lembrete'));
  end if;
  select * into m from outreach_messages where id = p_id for update;
  if not found then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('mensagem não encontrada'));
  end if;
  if m.step is distinct from p_step
     or not (m.status = v_expected or (m.status = 'falhou' and m.timed_out)) then
    if p_ok and ((p_step = 'saudacao' and m.greeting_sent_at is not null) or (p_step = 'mensagem' and m.sent_at is not null)) then
      return jsonb_build_object('status', 'existente', 'id', m.id, 'message_status', m.status);
    end if;
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('etapa não corresponde ao estado da mensagem'));
  end if;
  select * into s from outreach_settings where id = 1 for update;

  if not p_ok then
    update outreach_messages set status = 'falhou', failed_at = now(), timed_out = false,
      error = left(coalesce(nullif(btrim(p_error), ''), 'falha no envio'), 500)
        || case when p_step = 'mensagem' then ' (a saudação já tinha sido enviada)' else '' end
    where id = p_id;
    update outreach_settings set next_send_at = now() + make_interval(secs => s.min_delay_seconds) where id = 1;
    return jsonb_build_object('status', 'registrado', 'id', p_id, 'message_status', 'falhou');
  end if;

  if p_step = 'saudacao' then
    update outreach_messages set
      status = 'saudacao_enviada', greeting_sent_at = now(), timed_out = false, error = null, failed_at = null,
      body_due_at = now() + make_interval(secs => s.greeting_gap_min_seconds
        + floor(random() * (s.greeting_gap_max_seconds - s.greeting_gap_min_seconds + 1)))
    where id = p_id;
    insert into contact_events (lead_id, occurred_at, channel, note, source)
    values (m.lead_id, now(), 'whatsapp', 'Abordagem automática: saudação enviada', 'envio');
    if (select stage from leads where id = m.lead_id) = 'novo' then
      perform set_stage(m.lead_id, 'contatado', 'abordagem automática', 'envio');
    end if;
    update outreach_settings set next_send_at = now() + make_interval(secs => s.min_delay_seconds
      + floor(random() * (s.max_delay_seconds - s.min_delay_seconds + 1))) where id = 1;
    return jsonb_build_object('status', 'registrado', 'id', p_id, 'message_status', 'saudacao_enviada');
  end if;

  update outreach_messages set status = 'enviada', sent_at = now(), timed_out = false, error = null, failed_at = null
  where id = p_id;
  return jsonb_build_object('status', 'registrado', 'id', p_id, 'message_status', 'enviada');
end
$$;

create or replace view public.outreach_funnel
with (security_invoker = true) as
  select l.id, l.business_name, l.city, l.stage, l.fit_score, l.phone_e164, l.price_question_at,
         l.do_not_contact, o.status as message_status, o.greeting_sent_at, o.sent_at, o.created_at as message_created_at,
         r.received_at as last_reply_at, r.body as last_reply, r.kind as last_reply_kind,
         exists (select 1 from public.outreach_replies a where a.lead_id = l.id and a.media = 'audio') as sent_audio,
         case
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
         greatest(l.updated_at, o.created_at, o.greeting_sent_at, o.sent_at, r.received_at, o.held_at, o.no_reply_at, l.followup_closed_at) as movido_em
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
