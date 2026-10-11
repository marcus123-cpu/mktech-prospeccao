-- Duas janelas de horário.
--   * Atendimento (reply_window_start..reply_window_end, padrão 8h às 18h, nos
--     send_days): o texto personalizado que o robô manda depois que uma PESSOA
--     respondeu só sai nesse horário. Antes não tinha janela nenhuma.
--   * Prospecção (window_start..window_end, padrão 8h ao meio-dia): saudação de
--     lead novo e lembretes. Com prospect_after_noon ligado (desligado por
--     padrão), a prospecção vai até o fim do atendimento.
-- O limite diário, o tempo entre leads e a chave não mudam.
-- Depende da migration 20261010000500_lembretes (a função api_outreach_next é a dela).

alter table public.outreach_settings
  add column reply_window_start smallint not null default 8 check (reply_window_start between 0 and 23),
  add column reply_window_end smallint not null default 18 check (reply_window_end between 1 and 24),
  add column prospect_after_noon boolean not null default false,
  add constraint outreach_reply_window_ok check (reply_window_end > reply_window_start);

create or replace function public.admin_outreach_settings(p jsonb) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update outreach_settings set
    enabled = coalesce((p ->> 'enabled')::boolean, enabled),
    paused = coalesce((p ->> 'paused')::boolean, paused),
    min_delay_seconds = coalesce((p ->> 'min_delay_seconds')::int, min_delay_seconds),
    max_delay_seconds = coalesce((p ->> 'max_delay_seconds')::int, max_delay_seconds),
    greeting_gap_min_seconds = coalesce((p ->> 'greeting_gap_min_seconds')::int, greeting_gap_min_seconds),
    greeting_gap_max_seconds = coalesce((p ->> 'greeting_gap_max_seconds')::int, greeting_gap_max_seconds),
    daily_limit = coalesce((p ->> 'daily_limit')::int, daily_limit),
    window_start = coalesce((p ->> 'window_start')::smallint, window_start),
    window_end = coalesce((p ->> 'window_end')::smallint, window_end),
    reply_window_start = coalesce((p ->> 'reply_window_start')::smallint, reply_window_start),
    reply_window_end = coalesce((p ->> 'reply_window_end')::smallint, reply_window_end),
    prospect_after_noon = coalesce((p ->> 'prospect_after_noon')::boolean, prospect_after_noon),
    send_days = case when jsonb_typeof(p -> 'send_days') = 'array'
                     then array(select jsonb_array_elements_text(p -> 'send_days')::smallint) else send_days end,
    min_fit_score = coalesce((p ->> 'min_fit_score')::int, min_fit_score),
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1;
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
  v_dia_ok boolean;
  v_atendimento boolean;
  v_prospeccao boolean;
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

  -- Duas janelas: atendimento (texto depois que uma pessoa respondeu) e
  -- prospecção (saudação de lead novo e lembretes). A prospecção vai até
  -- window_end, ou até o fim do atendimento se o Marcos liberar "depois do meio-dia".
  v_dia_ok := extract(isodow from v_local)::smallint = any (s.send_days);
  v_atendimento := v_dia_ok and extract(hour from v_local) >= s.reply_window_start
                   and extract(hour from v_local) < s.reply_window_end;
  v_prospeccao := v_dia_ok and extract(hour from v_local) >= s.window_start
                  and extract(hour from v_local) < case when s.prospect_after_noon
                                                         then greatest(s.window_end, s.reply_window_end)
                                                         else s.window_end end;

  -- Uma etapa por vez: se algo está saindo agora, espera.
  if exists (select 1 from outreach_messages where status in ('enviando_saudacao', 'enviando_mensagem'))
     or exists (select 1 from outreach_followups where status = 'enviando') then
    return jsonb_build_object('status', 'aguardar', 'segundos', 15, 'motivo', 'etapa em andamento');
  end if;

  -- 1) Mensagem principal de quem já recebeu a saudação (menos as seguradas).
  if v_atendimento then
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
  end if;

  -- 2) Saudação de um lead novo: horário, dias, limite diário e espera.
  if not v_prospeccao then
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
