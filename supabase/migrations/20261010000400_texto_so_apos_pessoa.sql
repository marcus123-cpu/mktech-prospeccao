-- Regra final: o texto personalizado só sai DEPOIS de uma resposta humana à
-- saudação. Nunca sai por tempo. Resposta automática só marca o lead como
-- "Aguardando humano". Sem pessoa em 2 dias úteis desde a saudação, vai para
-- "Sem resposta" e nada é enviado sozinho.

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

create or replace function public.admin_outreach_reclassify(p_reply uuid, p_kind text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r outreach_replies;
begin
  perform require_admin();
  if p_kind not in ('automatica', 'humana') then
    raise exception 'classificação inválida' using errcode = '22023';
  end if;
  update outreach_replies set kind = p_kind, reclassified_by = auth.uid(), reclassified_at = now()
  where id = p_reply returning * into r;
  if r.id is null then
    return;
  end if;
  if p_kind = 'humana' then
    update outreach_messages set held_at = null, held_reason = null, no_reply_at = null,
      body_due_at = now() + interval '45 seconds'
    where id = r.message_id and status = 'saudacao_enviada' and sent_at is null;
    if (select stage from leads where id = r.lead_id) in ('novo', 'contatado') then
      perform set_stage(r.lead_id, 'respondeu', 'resposta reclassificada como de pessoa', 'envio');
    end if;
    if r.asks_price then
      update leads set price_question_at = coalesce(price_question_at, r.received_at) where id = r.lead_id;
    end if;
  elsif not exists (
    select 1 from outreach_replies where lead_id = r.lead_id and kind = 'humana' and asks_price
  ) then
    update leads set price_question_at = null where id = r.lead_id;
  end if;
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
  if exists (select 1 from outreach_messages where status in ('enviando_saudacao', 'enviando_mensagem')) then
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
  select count(*) into v_sent from outreach_messages where greeting_sent_at >= v_day_start;
  if v_sent >= s.daily_limit then
    return jsonb_build_object('status', 'limite_diario', 'enviadas_hoje', v_sent);
  end if;
  if s.next_send_at is not null and s.next_send_at > now() then
    return jsonb_build_object('status', 'aguardar', 'motivo', 'tempo de segurança entre leads',
      'segundos', greatest(1, ceil(extract(epoch from s.next_send_at - now()))::int));
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

create or replace view public.outreach_funnel
with (security_invoker = true) as
  select l.id, l.business_name, l.city, l.stage, l.fit_score, l.phone_e164, l.price_question_at,
         l.do_not_contact, o.status as message_status, o.greeting_sent_at, o.sent_at, o.created_at as message_created_at,
         r.received_at as last_reply_at, r.body as last_reply, r.kind as last_reply_kind,
         exists (select 1 from public.outreach_replies a where a.lead_id = l.id and a.media = 'audio') as sent_audio,
         case
           when l.stage = 'fechado' then 'fechado'
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
         greatest(l.updated_at, o.created_at, o.greeting_sent_at, o.sent_at, r.received_at, o.held_at, o.no_reply_at) as movido_em
  from public.leads l
  left join lateral (
    select * from public.outreach_messages x where x.lead_id = l.id and x.status <> 'cancelada'
    order by x.created_at desc limit 1
  ) o on true
  left join lateral (
    select * from public.outreach_replies y where y.lead_id = l.id order by y.received_at desc limit 1
  ) r on true
  where o.id is not null or l.stage in ('respondeu', 'interessado', 'proposta_enviada', 'fechado');
