-- Secretário: depois que a mensagem personalizada saiu e a pessoa respondeu,
-- o Hermes continua a conversa como o Marcos (passos 3 e 4 do método), sem
-- limite de respostas, até o atendimento acabar.
--   * Chave própria (secretary_enabled), desligada por padrão; só vale com a
--     chave geral do envio ligada e no horário de atendimento.
--   * O Hermes lê as conversas que esperam resposta (api_secretary_pending) e
--     grava a resposta ou passa a conversa para o Marcos (api_secretary_save).
--   * Passa para o Marcos: dúvida que ele não sabe, hora de fechar, preço,
--     pergunta se é robô, áudio, ou quando o Marcos escreve à mão no chip.
--     Depois disso o secretário não fala mais com esse lead até o Marcos devolver.
--   * Uma resposta por mensagem da pessoa; se ela escrever de novo antes de a
--     resposta sair, a resposta velha é cancelada e o Hermes responde de novo.
--   * Nada é reenviado: resposta sem confirmação vira "falhou".
-- Depende da migration 20261011000300_horarios_atendimento.

alter table public.outreach_settings add column secretary_enabled boolean not null default false;
alter table public.leads
  add column secretary_handoff_at timestamptz,
  add column secretary_handoff_reason text check (length(secretary_handoff_reason) <= 500),
  add column secretary_returned_at timestamptz;

create table public.outreach_secretary (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  phone_e164 text not null,
  -- received_at da última mensagem da pessoa que esta resposta atende
  reply_ref timestamptz not null,
  status text not null default 'pronta' check (status in ('pronta', 'enviando', 'enviada', 'falhou', 'cancelada')),
  body text not null check (length(body) between 1 and 700),
  due_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (length(cancel_reason) <= 300),
  error text check (length(error) <= 500),
  created_at timestamptz not null default now()
);
create unique index outreach_secretary_uq on public.outreach_secretary (lead_id, reply_ref) where status <> 'cancelada';
create index outreach_secretary_status_idx on public.outreach_secretary (status, due_at);
alter table public.outreach_secretary enable row level security;
revoke all on public.outreach_secretary from anon, authenticated;
grant select on public.outreach_secretary to authenticated;
create policy admin_le on public.outreach_secretary for select to authenticated using (public.is_admin());
grant all on public.outreach_secretary to service_role;

-- Conversas em andamento: a mensagem personalizada já saiu, a pessoa (não um
-- robô) escreveu depois da nossa última mensagem e o lead não está com o Marcos.
create or replace function public.outreach_secretary_state() returns table (
  lead_id uuid, phone_e164 text, business_name text, body_sent_at timestamptz, last_in timestamptz,
  last_out timestamptz, last_mk timestamptz)
language sql stable
set search_path = public
as $$
  select b.* from (
    select l.id, m.phone_e164, l.business_name, m.sent_at,
           (select max(r.received_at) from outreach_replies r
             where r.lead_id = l.id and r.kind = 'humana' and not r.opt_out) as last_in,
           greatest(m.sent_at,
             (select max(x.sent_at) from outreach_secretary x where x.lead_id = l.id and x.status = 'enviada'),
             (select max(u.sent_at) from outreach_followups u where u.lead_id = l.id and u.status = 'enviado')) as last_out,
           (select max(o.sent_at) from outreach_outbound o where o.lead_id = l.id
             and o.sent_at > coalesce(l.secretary_returned_at, '-infinity'::timestamptz)) as last_mk
    from leads l
    join lateral (select * from outreach_messages o where o.lead_id = l.id and o.status = 'enviada'
                  order by o.sent_at desc limit 1) m on true
    where not l.do_not_contact and l.secretary_handoff_at is null
      and l.stage not in ('fechado', 'sem_interesse', 'desqualificado')
  ) b
  where b.last_in is not null and b.last_in > b.last_out
$$;
revoke execute on function public.outreach_secretary_state() from public, anon, authenticated;

-- Arruma a fila do secretário: o Marcos escreveu à mão (a conversa é dele),
-- lead bloqueado/passado, ou a pessoa escreveu de novo depois da resposta pronta.
create or replace function public.outreach_secretary_tidy() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  z record;
  sr outreach_secretary;
begin
  for z in select * from outreach_secretary_state() where last_mk is not null and last_mk > body_sent_at loop
    update leads set secretary_handoff_at = now(), secretary_handoff_reason = 'você escreveu para a pessoa pelo celular'
    where id = z.lead_id and secretary_handoff_at is null;
  end loop;
  for sr in select x.* from outreach_secretary x join leads l on l.id = x.lead_id
            where x.status = 'pronta'
              and (l.do_not_contact or l.secretary_handoff_at is not null
                   or exists (select 1 from outreach_replies r where r.lead_id = x.lead_id and r.kind = 'humana'
                              and r.received_at > x.reply_ref)) loop
    update outreach_secretary set status = 'cancelada', cancelled_at = now(),
      cancel_reason = case when (select do_not_contact from leads where id = sr.lead_id) then 'lead pediu para parar'
                           when (select secretary_handoff_at from leads where id = sr.lead_id) is not null then 'conversa passada para o Marcos'
                           else 'a pessoa escreveu de novo; o secretário responde de novo' end
    where id = sr.id;
  end loop;
end
$$;
revoke execute on function public.outreach_secretary_tidy() from public, anon, authenticated;

-- GET do Hermes: conversas que esperam resposta, com os dados do lead e o
-- histórico. Espera 1 minuto depois da última mensagem da pessoa (ela pode
-- estar escrevendo mais). Com o secretário desligado, devolve vazio.
create or replace function public.api_secretary_pending(p_token uuid, p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s outreach_settings;
  v jsonb := '[]'::jsonb;
  z record;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  select * into s from outreach_settings where id = 1;
  if not (s.enabled and s.secretary_enabled) then
    return jsonb_build_object('status', 'desligado', 'conversas', '[]'::jsonb);
  end if;
  perform outreach_secretary_tidy();
  for z in select st.* from outreach_secretary_state() st
           where st.last_in <= now() - interval '1 minute'
             and (st.last_mk is null or st.last_mk <= st.body_sent_at)
             and not exists (select 1 from outreach_secretary x
                             where x.lead_id = st.lead_id and x.reply_ref >= st.last_in and x.status <> 'cancelada')
           order by st.last_in
           limit greatest(1, least(coalesce(p_limit, 5), 20)) loop
    v := v || jsonb_build_array(jsonb_build_object(
      'lead_id', z.lead_id,
      'reply_ref', z.last_in,
      'lead', lead_approach_context(z.lead_id),
      'conversa', (
        select coalesce(jsonb_agg(jsonb_build_object('de', t.de, 'texto', t.texto, 'em', t.em) order by t.em), '[]'::jsonb)
        from (
          select * from (
            select 'marcos' as de, o.greeting as texto, o.greeting_sent_at as em from outreach_messages o
              where o.lead_id = z.lead_id and o.greeting_sent_at is not null
            union all
            select 'marcos', o.body, o.sent_at from outreach_messages o where o.lead_id = z.lead_id and o.sent_at is not null
            union all
            select 'marcos', x.body, x.sent_at from outreach_secretary x where x.lead_id = z.lead_id and x.status = 'enviada'
            union all
            select 'marcos', u.body, u.sent_at from outreach_followups u where u.lead_id = z.lead_id and u.status = 'enviado'
            union all
            select 'cliente', case when r.media = 'audio' then '[áudio]' else r.body end, r.received_at
              from outreach_replies r where r.lead_id = z.lead_id and r.kind = 'humana'
          ) a order by em desc limit 40
        ) t)));
  end loop;
  return jsonb_build_object('status', 'ok', 'conversas', v);
end
$$;
revoke execute on function public.api_secretary_pending(uuid, integer) from public, anon, authenticated;
grant execute on function public.api_secretary_pending(uuid, integer) to service_role;

-- POST do Hermes: {reply_ref, resposta?, passar_para_marcos?}. A resposta já
-- foi conferida pela API (texto técnico, link, preço...). Pode ter as duas:
-- responde ("já te explico certinho") e passa para o Marcos.
create or replace function public.api_secretary_save(p_token uuid, p_lead uuid, p jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s outreach_settings;
  z record;
  v_text text := nullif(btrim(p ->> 'resposta'), '');
  v_handoff text := nullif(btrim(p ->> 'passar_para_marcos'), '');
  v_ref timestamptz := nullif(p ->> 'reply_ref', '')::timestamptz;
  v_id uuid;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if v_text is null and v_handoff is null then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('mande resposta ou passar_para_marcos'));
  end if;
  select * into s from outreach_settings where id = 1;
  if not (s.enabled and s.secretary_enabled) then
    return jsonb_build_object('status', 'desligado');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-secretario', 0));
  perform outreach_secretary_tidy();
  select * into z from outreach_secretary_state() st where st.lead_id = p_lead;
  if not found then
    return jsonb_build_object('status', 'sem_conversa', 'motivo', 'a conversa não espera resposta (passada para o Marcos, bloqueada ou já respondida)');
  end if;
  if v_ref is null or v_ref <> z.last_in then
    return jsonb_build_object('status', 'desatualizada', 'motivo', 'a pessoa escreveu de novo; leia a conversa outra vez', 'reply_ref', z.last_in);
  end if;
  if exists (select 1 from outreach_secretary x where x.lead_id = p_lead and x.reply_ref >= z.last_in and x.status <> 'cancelada') then
    return jsonb_build_object('status', 'existente');
  end if;
  if v_text is not null then
    insert into outreach_secretary (lead_id, phone_e164, reply_ref, body, due_at)
    values (p_lead, z.phone_e164, z.last_in, left(v_text, 700), now() + make_interval(secs => 20 + floor(random() * 41)))
    returning id into v_id;
  end if;
  if v_handoff is not null then
    update leads set secretary_handoff_at = now(), secretary_handoff_reason = left(v_handoff, 500) where id = p_lead;
    insert into lead_notes (lead_id, body) values (p_lead, left('Secretário passou a conversa para você: ' || v_handoff, 2000));
  end if;
  return jsonb_build_object('status', case when v_id is null then 'passada' else 'criada' end, 'id', v_id,
    'passada_para_marcos', v_handoff is not null);
end
$$;
revoke execute on function public.api_secretary_save(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.api_secretary_save(uuid, uuid, jsonb) to service_role;

-- Painel: liga/desliga o secretário e devolve uma conversa ao secretário.
create or replace function public.admin_secretary(p_enabled boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update outreach_settings set secretary_enabled = p_enabled, updated_at = now(), updated_by = auth.uid() where id = 1;
end
$$;
revoke execute on function public.admin_secretary(boolean) from public, anon, authenticated;
grant execute on function public.admin_secretary(boolean) to authenticated;

create or replace function public.admin_secretary_return(p_lead uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  -- O que o Marcos escreveu à mão até agora não volta a passar a conversa para ele.
  update leads set secretary_handoff_at = null, secretary_handoff_reason = null, secretary_returned_at = now()
  where id = p_lead;
end
$$;
revoke execute on function public.admin_secretary_return(uuid) from public, anon, authenticated;
grant execute on function public.admin_secretary_return(uuid) to authenticated;

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
             greatest((select max(o.sent_at) from outreach_outbound o where o.lead_id = l.id),
                      (select max(x.sent_at) from outreach_secretary x where x.lead_id = l.id and x.status = 'enviada')) as out_mk
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
  sr outreach_secretary;
  s outreach_settings;
  v_expected text := case p_step when 'saudacao' then 'enviando_saudacao' when 'mensagem' then 'enviando_mensagem' end;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if p_step = 'resposta' then
    select * into sr from outreach_secretary where id = p_id for update;
    if not found then
      return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('resposta não encontrada'));
    end if;
    if sr.status = 'enviada' and p_ok then
      return jsonb_build_object('status', 'existente', 'id', sr.id);
    end if;
    if sr.status not in ('enviando', 'falhou') then
      return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('etapa não corresponde ao estado da resposta'));
    end if;
    if p_ok then
      update outreach_secretary set status = 'enviada', sent_at = now(), error = null, failed_at = null where id = p_id;
      insert into contact_events (lead_id, occurred_at, channel, note, source)
      values (sr.lead_id, now(), 'whatsapp', 'Secretário respondeu', 'envio');
      return jsonb_build_object('status', 'registrado', 'id', p_id, 'message_status', 'enviada');
    end if;
    update outreach_secretary set status = 'falhou', failed_at = now(),
      error = left(coalesce(nullif(btrim(p_error), ''), 'falha no envio'), 500) where id = p_id;
    return jsonb_build_object('status', 'registrado', 'id', p_id, 'message_status', 'falhou');
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
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('etapa deve ser saudacao, mensagem, lembrete ou resposta'));
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
