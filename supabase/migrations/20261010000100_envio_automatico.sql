-- Envio automático da primeira mensagem para o lead pelo WhatsApp.
--
-- Como funciona:
--   1. O Hermes lê o diagnóstico e os dados do lead e escreve a mensagem
--      (elogio concreto + dor + onde melhorar). A API valida e a mensagem
--      entra na fila como "pronta". Escrever não envia nada.
--   2. Um enviador no PC do Marcos pede ao servidor a próxima etapa. O servidor
--      decide tudo: chave global, pausa, horário e dias permitidos (São Paulo),
--      limite diário e o tempo de espera aleatório entre um lead e outro.
--   3. Primeiro vai a saudação (bom dia / boa tarde / boa noite, conforme a hora
--      em São Paulo); depois de alguns segundos, a mensagem principal.
--   4. Respostas recebidas são classificadas (automática x pessoa). Só resposta
--      de pessoa move o lead para "respondeu". Pedido para parar bloqueia o lead.
--
-- Segurança: a chave global nasce DESLIGADA. Cada etapa é entregue no máximo
-- uma vez: se o enviador não confirmar em 5 minutos, a etapa vira "falhou" e
-- nunca é reenviada sozinha. Um lead e um telefone recebem no máximo uma
-- abordagem automática.

-- Escopos novos: "mensagens:escrever" (Hermes escreve, não envia) e
-- "envio:operar" (só o enviador; token próprio, criado na tela Envio).
alter table public.integration_tokens drop constraint integration_scopes_validos;
alter table public.integration_tokens add constraint integration_scopes_validos check (
  scopes <@ array['duplicados:ler', 'candidatos:criar', 'execucoes:registrar', 'config:ler', 'mensagens:escrever', 'envio:operar']
);
alter table public.integration_tokens alter column scopes
  set default array['duplicados:ler', 'candidatos:criar', 'execucoes:registrar', 'config:ler', 'mensagens:escrever'];
update public.integration_tokens
set scopes = scopes || array['mensagens:escrever']
where revoked_at is null and 'candidatos:criar' = any (scopes) and not 'mensagens:escrever' = any (scopes);

-- Contatos feitos pelo envio automático ficam marcados como tal.
alter table public.contact_events drop constraint contact_events_source_check;
alter table public.contact_events add constraint contact_events_source_check
  check (source in ('manual', 'importacao', 'envio'));

-- Pedido de "não me mande mais" (LGPD): o lead nunca mais entra na fila.
alter table public.leads
  add column do_not_contact boolean not null default false,
  add column do_not_contact_at timestamptz;

-- Mensagem do Hermes recusada pela validação (ou geração que falhou): o lead
-- é pulado, nada é enviado, e com 3 recusas sai da fila e aparece no painel
-- como "precisa de atenção" até o Marcos liberar de novo.
alter table public.leads
  add column outreach_failures integer not null default 0,
  add column outreach_last_error text check (length(outreach_last_error) <= 2000),
  add column outreach_last_error_at timestamptz;

create table public.outreach_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  paused boolean not null default false,
  min_delay_seconds integer not null default 180 check (min_delay_seconds between 60 and 86400),
  max_delay_seconds integer not null default 300 check (max_delay_seconds between 60 and 86400),
  greeting_gap_min_seconds integer not null default 40 check (greeting_gap_min_seconds between 10 and 1800),
  greeting_gap_max_seconds integer not null default 120 check (greeting_gap_max_seconds between 10 and 1800),
  daily_limit integer not null default 10 check (daily_limit between 1 and 200),
  window_start smallint not null default 8 check (window_start between 0 and 23),
  window_end smallint not null default 12 check (window_end between 1 and 24),
  send_days smallint[] not null default '{1,2,3,4,5}' check (send_days <@ '{1,2,3,4,5,6,7}' and cardinality(send_days) > 0),
  min_fit_score integer not null default 60 check (min_fit_score between 0 and 100),
  next_send_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint outreach_delay_ordem check (max_delay_seconds >= min_delay_seconds),
  constraint outreach_gap_ordem check (greeting_gap_max_seconds >= greeting_gap_min_seconds),
  constraint outreach_janela_ordem check (window_end > window_start)
);
insert into public.outreach_settings (id) values (1);

create table public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  status text not null default 'pronta' check (status in (
    'pronta', 'enviando_saudacao', 'saudacao_enviada', 'enviando_mensagem', 'enviada', 'falhou', 'cancelada'
  )),
  step text check (step in ('saudacao', 'mensagem')),
  phone_e164 text,
  compliment text not null check (length(compliment) between 1 and 300),
  pain text not null check (length(pain) between 1 and 300),
  improvement text not null check (length(improvement) between 1 and 300),
  body text not null check (length(body) between 1 and 700),
  greeting text,
  claimed_at timestamptz,
  greeting_sent_at timestamptz,
  body_due_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  timed_out boolean not null default false,
  error text check (length(error) <= 500),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now()
);
-- Uma abordagem automática por lead (cancelada não conta).
create unique index outreach_messages_lead_uq on public.outreach_messages (lead_id) where status <> 'cancelada';
create index outreach_messages_status_idx on public.outreach_messages (status, created_at);
create index outreach_messages_phone_idx on public.outreach_messages (phone_e164) where greeting_sent_at is not null;

create table public.outreach_replies (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  message_id uuid references public.outreach_messages (id) on delete set null,
  phone_e164 text not null,
  body text not null check (length(body) between 1 and 4000),
  received_at timestamptz not null,
  kind text not null check (kind in ('automatica', 'humana')),
  reason text check (length(reason) <= 500),
  opt_out boolean not null default false,
  reclassified_by uuid,
  reclassified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index outreach_replies_uq on public.outreach_replies (phone_e164, received_at, md5(body));
create index outreach_replies_lead_idx on public.outreach_replies (lead_id, received_at desc);
create index outreach_replies_created_idx on public.outreach_replies (created_at desc);

alter table public.outreach_settings enable row level security;
alter table public.outreach_messages enable row level security;
alter table public.outreach_replies enable row level security;
revoke all on public.outreach_settings, public.outreach_messages, public.outreach_replies from anon, authenticated;
grant select on public.outreach_settings, public.outreach_messages, public.outreach_replies to authenticated;
create policy admin_le on public.outreach_settings for select to authenticated using (public.is_admin());
create policy admin_le on public.outreach_messages for select to authenticated using (public.is_admin());
create policy admin_le on public.outreach_replies for select to authenticated using (public.is_admin());
grant all on public.outreach_settings, public.outreach_messages, public.outreach_replies to service_role;

-- Saudação conforme a hora local de São Paulo: 5h-11h bom dia, 12h-17h boa
-- tarde, 18h-4h boa noite. Usa o primeiro nome do responsável quando houver.
create or replace function public.outreach_greeting(p_local timestamp, p_name text) returns text
language sql immutable
as $$
  select case
           when extract(hour from p_local) between 5 and 11 then 'Bom dia'
           when extract(hour from p_local) between 12 and 17 then 'Boa tarde'
           else 'Boa noite'
         end
         || coalesce(', ' || nullif(initcap(split_part(btrim(coalesce(p_name, '')), ' ', 1)), ''), '')
         || '! Tudo bem?'
$$;

-- Formas do mesmo celular brasileiro: o WhatsApp às vezes entrega o número
-- sem o nono dígito (+55 17 9225-0729 em vez de +55 17 99225-0729).
create or replace function public.outreach_phone_variants(p text) returns text[]
language sql immutable
set search_path = public
as $$
  select case
           when n ~ '^\+55[1-9][0-9]9[0-9]{8}$' then array[n, left(n, 5) || substr(n, 7)]
           when n ~ '^\+55[1-9][0-9][6-9][0-9]{7}$' then array[n, left(n, 5) || '9' || substr(n, 6)]
           when n is not null then array[n]
           else '{}'::text[]
         end
  from (select norm_phone(p) as n) x
$$;

-- Lead que pode receber a abordagem automática agora.
create or replace function public.outreach_lead_ok(l public.leads) returns boolean
language sql stable
set search_path = public
as $$
  select l.stage = 'novo'
     and not l.contacted
     and not l.do_not_contact
     and l.phone_e164 is not null
     and not exists (
       select 1 from outreach_messages o
       where o.phone_e164 = l.phone_e164 and o.greeting_sent_at is not null and o.lead_id <> l.id)
     and not exists (
       select 1 from leads x
       where x.phone_e164 = l.phone_e164 and x.id <> l.id and (x.contacted or x.do_not_contact))
$$;

-- Hermes: leads com diagnóstico que ainda precisam da mensagem.
create or replace function public.api_outreach_pending(p_token uuid, p_limit integer) returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object('status', 'ok', 'leads', coalesce(jsonb_agg(lead_approach_context(x.id) order by x.ord), '[]'))
  from (
    select l.id, row_number() over (order by l.fit_score desc nulls last, l.created_at) as ord
    from leads l, outreach_settings s
    where p_token is not null
      and s.id = 1
      and outreach_lead_ok(l)
      and coalesce(l.fit_score, 0) >= s.min_fit_score
      and coalesce(l.recommended_offer, '') <> 'nao_recomendado'
      and l.outreach_failures < 3
      and exists (select 1 from lead_diagnoses d where d.lead_id = l.id)
      and not exists (select 1 from outreach_messages o where o.lead_id = l.id and o.status <> 'cancelada')
    order by ord
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  ) x
$$;

create or replace function public.api_outreach_context(p_token uuid, p_lead uuid) returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select case when p_token is null then null else lead_approach_context(p_lead) end
$$;

-- Hermes: mensagem recusada pela validação. Guarda os motivos (não o texto)
-- para o painel mostrar; nada é enviado.
create or replace function public.api_outreach_note_failure(p_token uuid, p_lead uuid, p_errors text) returns jsonb
language sql
security definer
set search_path = public
as $$
  update leads set outreach_failures = outreach_failures + 1, outreach_last_error = left(p_errors, 2000),
                   outreach_last_error_at = now()
  where id = p_lead and p_token is not null
  returning jsonb_build_object('falhas', outreach_failures, 'fora_da_fila', outreach_failures >= 3)
$$;

-- Hermes: grava a mensagem já validada pela API. Repetir o mesmo texto não
-- duplica; o lead precisa continuar apto.
create or replace function public.api_outreach_save(p_token uuid, p_lead uuid, p jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead leads;
  v_existing outreach_messages;
  v_id uuid;
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
  insert into outreach_messages (lead_id, phone_e164, compliment, pain, improvement, body)
  values (p_lead, v_lead.phone_e164, p ->> 'elogio', p ->> 'dor', p ->> 'melhoria', p ->> 'mensagem')
  returning id into v_id;
  update leads set outreach_failures = 0, outreach_last_error = null, outreach_last_error_at = null where id = p_lead;
  return jsonb_build_object('status', 'criado', 'message_id', v_id);
end
$$;

-- Enviador: estado da chave, sem reservar nada (para teste de conexão).
create or replace function public.api_outreach_state(p_token uuid) returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object('status', 'ok', 'enabled', s.enabled, 'paused', s.paused, 'daily_limit', s.daily_limit,
    'window_start', s.window_start, 'window_end', s.window_end, 'next_send_at', s.next_send_at,
    'na_fila', (select count(*) from outreach_messages where status = 'pronta'))
  from outreach_settings s where s.id = 1 and p_token is not null
$$;

-- Enviador: próxima etapa a enviar. Devolve status "enviar" com o texto, ou o
-- motivo de não enviar agora (desligado, pausado, fora_do_horario,
-- limite_diario, aguardar, fila_vazia).
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

  -- 1) Mensagem principal de quem já recebeu a saudação.
  for m in select * from outreach_messages where status = 'saudacao_enviada' order by body_due_at loop
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

-- Enviador: resultado de uma etapa. A confirmação atrasada (depois dos 5
-- minutos) ainda é aceita, para o histórico ficar certo.
create or replace function public.api_outreach_result(p_token uuid, p_id uuid, p_step text, p_ok boolean, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m outreach_messages;
  s outreach_settings;
  v_expected text := case p_step when 'saudacao' then 'enviando_saudacao' when 'mensagem' then 'enviando_mensagem' end;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if v_expected is null then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('etapa deve ser saudacao ou mensagem'));
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

-- Enviador: mensagem recebida, já classificada pela API (automática ou
-- pessoa). Mensagens de quem não foi abordado não são guardadas (LGPD).
create or replace function public.api_outreach_reply(p_token uuid, p jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phones text[] := outreach_phone_variants(p ->> 'phone_e164');
  v_kind text := p ->> 'kind';
  v_opt boolean := coalesce((p ->> 'opt_out')::boolean, false);
  v_at timestamptz := coalesce(nullif(p ->> 'received_at', '')::timestamptz, now());
  m outreach_messages;
  v_id uuid;
  v_stage lead_stage;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if v_kind not in ('automatica', 'humana') then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('kind inválido'));
  end if;
  select * into m from outreach_messages
  where phone_e164 = any (v_phones) and greeting_sent_at is not null
  order by greeting_sent_at desc limit 1;
  if not found then
    return jsonb_build_object('status', 'ignorada', 'motivo', 'telefone não recebeu abordagem automática');
  end if;

  insert into outreach_replies (lead_id, message_id, phone_e164, body, received_at, kind, reason, opt_out)
  values (m.lead_id, m.id, m.phone_e164, left(p ->> 'body', 4000), v_at, v_kind, left(p ->> 'reason', 500), v_opt)
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
  if v_kind = 'humana' then
    select stage into v_stage from leads where id = m.lead_id;
    if v_stage in ('novo', 'contatado') then
      perform set_stage(m.lead_id, 'respondeu', 'respondeu à abordagem automática', 'envio');
    end if;
  end if;
  return jsonb_build_object('status', 'registrada', 'reply_id', v_id, 'lead_id', m.lead_id, 'kind', v_kind,
    'conversa', v_kind = 'humana', 'opt_out', v_opt);
end
$$;

-- Painel ----------------------------------------------------------------

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
    send_days = case when jsonb_typeof(p -> 'send_days') = 'array'
                     then array(select jsonb_array_elements_text(p -> 'send_days')::smallint) else send_days end,
    min_fit_score = coalesce((p ->> 'min_fit_score')::int, min_fit_score),
    updated_at = now(),
    updated_by = auth.uid()
  where id = 1;
end
$$;

create or replace function public.admin_outreach_cancel(p_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update outreach_messages set status = 'cancelada', cancelled_at = now(),
    cancel_reason = coalesce(nullif(btrim(p_reason), ''), 'cancelada no painel')
  where id = p_id and status in ('pronta', 'saudacao_enviada', 'falhou');
end
$$;

-- Corrige a classificação. Virar "pessoa" move o lead para "respondeu"; virar
-- "automática" não mexe na etapa (o Marcos ajusta à mão se precisar).
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
  if r.id is not null and p_kind = 'humana' and (select stage from leads where id = r.lead_id) in ('novo', 'contatado') then
    perform set_stage(r.lead_id, 'respondeu', 'resposta reclassificada como de pessoa', 'envio');
  end if;
end
$$;

-- Libera de novo um lead que saiu da fila por recusas seguidas.
create or replace function public.admin_outreach_retry(p_lead uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update leads set outreach_failures = 0, outreach_last_error = null, outreach_last_error_at = null where id = p_lead;
end
$$;

-- Token só do enviador: não cadastra nem lê leads, só opera a fila.
create or replace function public.admin_create_sender_token(p_name text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := 'mkt_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
begin
  perform require_admin();
  if nullif(btrim(p_name), '') is null then
    raise exception 'informe um nome para o token' using errcode = '22023';
  end if;
  insert into integration_tokens (name, token_hash, token_prefix, scopes)
  values (btrim(p_name), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), left(v_token, 10), array['envio:operar'])
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end
$$;

revoke execute on function
  public.outreach_greeting(timestamp, text),
  public.outreach_phone_variants(text),
  public.outreach_lead_ok(public.leads),
  public.api_outreach_pending(uuid, integer),
  public.api_outreach_context(uuid, uuid),
  public.api_outreach_save(uuid, uuid, jsonb),
  public.api_outreach_note_failure(uuid, uuid, text),
  public.api_outreach_state(uuid),
  public.api_outreach_next(uuid),
  public.api_outreach_result(uuid, uuid, text, boolean, text),
  public.api_outreach_reply(uuid, jsonb),
  public.admin_outreach_settings(jsonb),
  public.admin_outreach_cancel(uuid, text),
  public.admin_outreach_reclassify(uuid, text),
  public.admin_outreach_retry(uuid),
  public.admin_create_sender_token(text)
from public, anon, authenticated;

grant execute on function
  public.admin_outreach_settings(jsonb),
  public.admin_outreach_cancel(uuid, text),
  public.admin_outreach_reclassify(uuid, text),
  public.admin_outreach_retry(uuid),
  public.admin_create_sender_token(text)
to authenticated;

grant execute on function
  public.api_outreach_pending(uuid, integer),
  public.api_outreach_context(uuid, uuid),
  public.api_outreach_save(uuid, uuid, jsonb),
  public.api_outreach_note_failure(uuid, uuid, text),
  public.api_outreach_state(uuid),
  public.api_outreach_next(uuid),
  public.api_outreach_result(uuid, uuid, text, boolean, text),
  public.api_outreach_reply(uuid, jsonb)
to service_role;
