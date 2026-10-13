-- Dois estilos de mensagem depois da saudação, a pedido do Marcos (13/10):
--   agradecimento   o texto fica pronto antes ("Obrigado pelo retorno! Me
--                   chamo Marcos..."), como sempre foi;
--   lendo_resposta  o Hermes espera a pessoa responder, lê o que ela escreveu
--                   e só então escreve a mensagem (sem o agradecimento fixo).
-- Com "alternar" ligado no painel, cada lead novo na fila pega o estilo
-- contrário ao do anterior. O padrão continua só agradecimento.

alter table public.outreach_settings
  add column message_styles text not null default 'agradecimento'
    check (message_styles in ('agradecimento', 'alternar'));

alter table public.outreach_messages
  add column style text not null default 'agradecimento' check (style in ('agradecimento', 'lendo_resposta')),
  add column reply_body_at timestamptz,
  add column template_body text;

-- Painel: escolhe entre só agradecimento e alternar.
create or replace function public.admin_outreach_styles(p_styles text) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  if p_styles not in ('agradecimento', 'alternar') then
    raise exception 'estilo inválido' using errcode = '22023';
  end if;
  update outreach_settings set message_styles = p_styles, updated_at = now(), updated_by = auth.uid() where id = 1;
end
$$;
revoke execute on function public.admin_outreach_styles(text) from public, anon, authenticated;
grant execute on function public.admin_outreach_styles(text) to authenticated;

-- Grava a mensagem preparada; no modo alternar o estilo é o contrário do último lead.
create or replace function public.api_outreach_save(p_token uuid, p_lead uuid, p jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead leads;
  v_existing outreach_messages;
  v_id uuid;
  v_style text := 'agradecimento';
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  select * into v_lead from leads where id = p_lead for update;
  if not found then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('lead não encontrado'));
  end if;
  select * into v_existing from outreach_messages where lead_id = p_lead and status <> 'cancelada';
  if found then
    return jsonb_build_object('status', 'existente', 'message_id', v_existing.id, 'message_status', v_existing.status);
  end if;
  if not outreach_lead_ok(v_lead) then
    return jsonb_build_object('status', 'invalido',
      'errors', jsonb_build_array('lead não pode receber abordagem automática (já contatado, sem telefone, bloqueado ou telefone já abordado)'));
  end if;
  if (select message_styles from outreach_settings where id = 1) = 'alternar' then
    perform pg_advisory_xact_lock(hashtextextended('mktech-estilo', 0));
    select case when o.style = 'lendo_resposta' then 'agradecimento' else 'lendo_resposta' end into v_style
    from outreach_messages o order by o.created_at desc limit 1;
    v_style := coalesce(v_style, 'agradecimento');
  end if;
  insert into outreach_messages (lead_id, phone_e164, compliment, pain, improvement, body, style)
  values (p_lead, v_lead.phone_e164, p ->> 'elogio', p ->> 'dor', p ->> 'melhoria', p ->> 'mensagem', v_style)
  returning id into v_id;
  update leads set outreach_failures = 0, outreach_last_error = null, outreach_last_error_at = null where id = p_lead;
  return jsonb_build_object('status', 'criado', 'message_id', v_id, 'estilo', v_style);
end
$$;

-- Hermes: mensagens "lendo a resposta" esperando o texto (a pessoa já respondeu).
create or replace function public.api_outreach_reading_pending(p_token uuid, p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb := '[]'::jsonb;
  m outreach_messages;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  for m in select o.* from outreach_messages o join leads l on l.id = o.lead_id
           where o.style = 'lendo_resposta' and o.status = 'saudacao_enviada' and o.reply_body_at is null
             and o.no_reply_at is null and not l.do_not_contact
             and exists (select 1 from outreach_replies r where r.message_id = o.id and r.kind = 'humana')
           order by o.greeting_sent_at
           limit greatest(1, least(coalesce(p_limit, 5), 20)) loop
    v := v || jsonb_build_array(jsonb_build_object(
      'message_id', m.id,
      'lead_id', m.lead_id,
      'saudacao_enviada', m.greeting,
      'respostas', coalesce((select jsonb_agg(jsonb_build_object('texto', r.body, 'em', r.received_at) order by r.received_at)
                             from outreach_replies r where r.message_id = m.id and r.kind = 'humana'), '[]'::jsonb),
      'elogio', m.compliment, 'dor', m.pain, 'melhoria', m.improvement,
      'texto_preparado', coalesce(m.template_body, m.body),
      'lead', api_outreach_context(p_token, m.lead_id)));
  end loop;
  return jsonb_build_object('status', 'ok', 'mensagens', v);
end
$$;
revoke execute on function public.api_outreach_reading_pending(uuid, integer) from public, anon, authenticated;
grant execute on function public.api_outreach_reading_pending(uuid, integer) to service_role;

-- Hermes: grava o texto escrito depois de ler a resposta (a API já validou).
create or replace function public.api_outreach_reading_save(p_token uuid, p_message uuid, p_text text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m outreach_messages;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  select * into m from outreach_messages where id = p_message for update;
  if not found then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('mensagem não encontrada'));
  end if;
  if m.style <> 'lendo_resposta' or m.status <> 'saudacao_enviada' or m.reply_body_at is not null or m.no_reply_at is not null then
    return jsonb_build_object('status', 'desatualizada', 'motivo', 'a mensagem não espera mais o texto');
  end if;
  update outreach_messages set template_body = coalesce(template_body, body), body = p_text, reply_body_at = now()
  where id = m.id;
  return jsonb_build_object('status', 'gravada', 'message_id', m.id);
end
$$;
revoke execute on function public.api_outreach_reading_save(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.api_outreach_reading_save(uuid, uuid, text) to service_role;

-- Envio: igual a antes, menos a mensagem "lendo a resposta" ainda sem texto.
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
  v_target integer;
  v_greeting text;
  f record;
  v_fid uuid;
  v_text text;
  v_dia_ok boolean;
  v_atendimento boolean;
  v_prospeccao boolean;
  sr outreach_secretary;
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

  -- Resposta do secretário sem confirmação em 5 minutos: falhou e não é reenviada.
  update outreach_secretary set status = 'falhou', failed_at = now(),
    error = 'o enviador não confirmou em 5 minutos; não foi reenviada'
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
     or exists (select 1 from outreach_followups where status = 'enviando')
     or exists (select 1 from outreach_secretary where status = 'enviando') then
    return jsonb_build_object('status', 'aguardar', 'segundos', 15, 'motivo', 'etapa em andamento');
  end if;

  -- 1) Mensagem principal de quem já recebeu a saudação (menos as seguradas).
  if v_atendimento then
  for m in select * from outreach_messages
           where status = 'saudacao_enviada' and no_reply_at is null
             and exists (select 1 from outreach_replies r where r.message_id = outreach_messages.id and r.kind = 'humana')
             -- "Lendo a resposta": só sai depois que o Hermes escreveu o texto.
             and (style = 'agradecimento' or reply_body_at is not null)
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

  -- 1b) Secretário: resposta a quem está conversando, no horário de atendimento.
  if v_atendimento and s.secretary_enabled then
    perform outreach_secretary_tidy();
    select x.* into sr from outreach_secretary x
    where x.status = 'pronta' order by x.due_at limit 1;
    if found then
      if sr.due_at > now() then
        return jsonb_build_object('status', 'aguardar', 'motivo', 'secretário esperando para responder',
          'segundos', greatest(1, ceil(extract(epoch from sr.due_at - now()))::int));
      end if;
      update outreach_secretary set status = 'enviando', claimed_at = now() where id = sr.id;
      return jsonb_build_object('status', 'enviar', 'id', sr.id, 'etapa', 'resposta', 'telefone', sr.phone_e164,
        'texto', sr.body, 'lead', (select business_name from leads where id = sr.lead_id));
    end if;
  end if;

  -- 2) Saudação de um lead novo: horário, dias, limite diário e espera.
  if not v_prospeccao then
    return jsonb_build_object('status', 'fora_do_horario');
  end if;
  -- Sem meta pontual, preserva o limite diário antigo (novos + lembretes).
  if s.today_new_leads_date is distinct from v_local::date then
    select (select count(*) from outreach_messages where greeting_sent_at >= v_day_start)
         + (select count(*) from outreach_followups where claimed_at >= v_day_start) into v_sent;
    if v_sent >= s.daily_limit then
      return jsonb_build_object('status', 'limite_diario', 'enviadas_hoje', v_sent);
    end if;
  end if;
  if s.next_send_at is not null and s.next_send_at > now() then
    return jsonb_build_object('status', 'aguardar', 'motivo', 'tempo de segurança entre leads',
      'segundos', greatest(1, ceil(extract(epoch from s.next_send_at - now()))::int));
  end if;

  -- 2b) Lembrete para quem conversou e parou de responder (chave própria).
  if s.followups_enabled and
     (select count(*) from outreach_followups where claimed_at >= v_day_start) < s.daily_limit then
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

  -- A meta de hoje conta apenas novos contatos confirmados. A fila não é
  -- consumida: aumentar a meta permite continuar com o próximo lead.
  v_target := case when s.today_new_leads_date = v_local::date
                   then s.today_new_leads_target else s.daily_limit end;
  select count(*) into v_sent from outreach_messages where greeting_sent_at >= v_day_start;
  if v_sent >= v_target then
    return jsonb_build_object('status', 'limite_diario', 'enviadas_hoje', v_sent,
      'meta_hoje', v_target);
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

