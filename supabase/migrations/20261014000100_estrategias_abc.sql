-- Estratégias A/B/C, fluxo comercial em estados e trava de aprovação
-- (prompt do Marcos, 13/10). Só acrescenta: nenhuma coluna ou linha antiga é
-- apagada, e toda mudança comercial fica registrada em lead_commercial_events.
--   * outreach_messages.strategy: A direta, B consultiva, C vídeo. Mensagens
--     antigas ficam sem estratégia e aparecem como "antiga" na comparação.
--   * leads: quem respondeu, estado da conversa (1 a 9), interesse, vídeo
--     oferecido/autorizado/enviado e o estado mais avançado já alcançado.
--   * outreach_replies: intenção da resposta (positiva, neutra, negativa,
--     automática, esclarecimento, encaminhamento) e quem respondeu.
--   * outreach_settings.require_approval: com a trava ligada, a primeira
--     mensagem e as respostas do secretário só saem depois do clique do Marcos.
--     Começa DESLIGADA: esta migration não muda nada no envio.

alter table public.leads
  add column prospect_strategy text check (prospect_strategy in ('A', 'B', 'C')),
  add column contact_role text check (contact_role in ('recepcionista', 'proprietaria', 'gerente', 'marketing', 'automatico', 'desconhecido')),
  add column conversation_state text check (conversation_state in (
    'primeiro_contato', 'resposta_recebida', 'qualificacao', 'video', 'pos_video', 'interesse', 'negociacao', 'oportunidade', 'encerrado')),
  add column furthest_state_rank smallint not null default 0 check (furthest_state_rank between 0 and 8),
  add column commercial_interest text check (commercial_interest in ('desconhecido', 'nenhum', 'baixo', 'medio', 'alto')),
  add column video_offered_at timestamptz,
  add column video_authorized_at timestamptz,
  add column video_sent_at timestamptz,
  add column decision_maker_at timestamptz;

alter table public.outreach_messages
  add column strategy text check (strategy in ('A', 'B', 'C')),
  add column strategy_reason text check (length(strategy_reason) <= 300),
  add column strategy_stratum text check (length(strategy_stratum) <= 60),
  add column strategy_mode text check (strategy_mode in ('teste', 'recomendada')),
  add column approved_at timestamptz,
  add column approved_by uuid,
  add column body_approved_at timestamptz;
create index outreach_messages_strategy_idx on public.outreach_messages (strategy, strategy_stratum) where strategy is not null;

alter table public.outreach_secretary
  add column approved_at timestamptz,
  add column approved_by uuid;

alter table public.outreach_replies
  add column intent text check (intent in ('positiva', 'neutra', 'negativa', 'automatica', 'esclarecimento', 'encaminhamento')),
  add column contact_role text check (contact_role in ('recepcionista', 'proprietaria', 'gerente', 'marketing', 'automatico', 'desconhecido'));

alter table public.outreach_settings add column require_approval boolean not null default false;

-- Histórico comercial: cada mudança de estado, papel, interesse, vídeo ou
-- estratégia vira uma linha. Nada aqui é atualizado ou apagado.
create table public.lead_commercial_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  field text not null check (field in ('estado', 'papel_contato', 'interesse', 'video', 'estrategia', 'motivo_perda', 'acompanhamento')),
  old_value text,
  new_value text,
  source text not null check (source in ('auto', 'hermes', 'marcos')),
  note text check (length(note) <= 500),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index lead_commercial_events_lead_idx on public.lead_commercial_events (lead_id, created_at);
alter table public.lead_commercial_events enable row level security;
revoke all on public.lead_commercial_events from anon, authenticated;
grant select on public.lead_commercial_events to authenticated;
create policy admin_le on public.lead_commercial_events for select to authenticated using (public.is_admin());
grant all on public.lead_commercial_events to service_role;

create or replace function public.commercial_state_rank(p text) returns smallint
language sql immutable
as $$
  select case p when 'primeiro_contato' then 1 when 'resposta_recebida' then 2 when 'qualificacao' then 3
    when 'video' then 4 when 'pos_video' then 5 when 'interesse' then 6 when 'negociacao' then 7
    when 'oportunidade' then 8 else 0 end::smallint
$$;

create or replace function public.commercial_interest_rank(p text) returns smallint
language sql immutable
as $$
  select case p when 'baixo' then 1 when 'medio' then 2 when 'alto' then 3 else 0 end::smallint
$$;

-- Aplica mudanças comerciais e registra cada uma. Fonte 'auto' (resposta
-- classificada, saudação enviada) só avança: não volta estado, não troca um
-- papel conhecido por "desconhecido", não reabre conversa encerrada e não
-- baixa o interesse. Hermes e Marcos podem corrigir em qualquer direção.
-- Chaves: estado, papel_contato, interesse, video (oferecido|autorizado|enviado),
-- estrategia, motivo_perda, acompanhamento (data). Devolve os campos mudados.
create or replace function public.commercial_set(p_lead uuid, p jsonb, p_source text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l leads;
  v_changed jsonb := '[]'::jsonb;
  v_state text := nullif(p ->> 'estado', '');
  v_role text := nullif(p ->> 'papel_contato', '');
  v_int text := nullif(p ->> 'interesse', '');
  v_video text := nullif(p ->> 'video', '');
  v_strat text := nullif(p ->> 'estrategia', '');
  v_loss text := nullif(btrim(coalesce(p ->> 'motivo_perda', '')), '');
  v_follow timestamptz;
  v_note text := left(p_note, 500);
  v_uid uuid := auth.uid();
begin
  select * into l from leads where id = p_lead for update;
  if not found then
    raise exception 'lead não encontrado' using errcode = '22023';
  end if;
  if v_state is not null and v_state not in ('primeiro_contato', 'resposta_recebida', 'qualificacao', 'video', 'pos_video',
       'interesse', 'negociacao', 'oportunidade', 'encerrado') then
    raise exception 'estado inválido' using errcode = '22023';
  end if;
  if v_role is not null and v_role not in ('recepcionista', 'proprietaria', 'gerente', 'marketing', 'automatico', 'desconhecido') then
    raise exception 'papel inválido' using errcode = '22023';
  end if;
  if v_int is not null and v_int not in ('desconhecido', 'nenhum', 'baixo', 'medio', 'alto') then
    raise exception 'interesse inválido' using errcode = '22023';
  end if;
  if v_video is not null and v_video not in ('oferecido', 'autorizado', 'enviado') then
    raise exception 'vídeo inválido' using errcode = '22023';
  end if;
  if v_strat is not null and v_strat not in ('A', 'B', 'C') then
    raise exception 'estratégia inválida' using errcode = '22023';
  end if;
  if p ? 'acompanhamento' and nullif(p ->> 'acompanhamento', '') is not null then
    v_follow := (p ->> 'acompanhamento')::timestamptz;
  end if;

  -- Estado
  if v_state is not null and v_state is distinct from l.conversation_state
     and (p_source <> 'auto' or (
       coalesce(l.conversation_state, '') <> 'encerrado'
       and (v_state = 'encerrado' or commercial_state_rank(v_state) > commercial_state_rank(l.conversation_state)))) then
    insert into lead_commercial_events (lead_id, field, old_value, new_value, source, note, created_by)
    values (p_lead, 'estado', l.conversation_state, v_state, p_source, v_note, v_uid);
    update leads set conversation_state = v_state,
      furthest_state_rank = greatest(furthest_state_rank, commercial_state_rank(v_state))
    where id = p_lead;
    v_changed := v_changed || '"estado"'::jsonb;
  end if;

  -- Quem respondeu
  if v_role is not null and v_role is distinct from l.contact_role
     and (p_source <> 'auto' or v_role not in ('desconhecido', 'automatico') or l.contact_role is null) then
    insert into lead_commercial_events (lead_id, field, old_value, new_value, source, note, created_by)
    values (p_lead, 'papel_contato', l.contact_role, v_role, p_source, v_note, v_uid);
    update leads set contact_role = v_role,
      decision_maker_at = case when v_role in ('proprietaria', 'gerente', 'marketing') then coalesce(decision_maker_at, now())
                               else decision_maker_at end
    where id = p_lead;
    v_changed := v_changed || '"papel_contato"'::jsonb;
  end if;

  -- Interesse
  if v_int is not null and v_int is distinct from l.commercial_interest
     and (p_source <> 'auto' or l.commercial_interest is null or l.commercial_interest = 'desconhecido'
          or v_int = 'nenhum' or commercial_interest_rank(v_int) > commercial_interest_rank(l.commercial_interest)) then
    insert into lead_commercial_events (lead_id, field, old_value, new_value, source, note, created_by)
    values (p_lead, 'interesse', l.commercial_interest, v_int, p_source, v_note, v_uid);
    update leads set commercial_interest = v_int where id = p_lead;
    v_changed := v_changed || '"interesse"'::jsonb;
  end if;

  -- Vídeo: cada marco uma vez só (não sobrescreve a data).
  if v_video = 'oferecido' and l.video_offered_at is null then
    update leads set video_offered_at = now() where id = p_lead;
  elsif v_video = 'autorizado' and l.video_authorized_at is null then
    update leads set video_authorized_at = now(), video_offered_at = coalesce(video_offered_at, now()) where id = p_lead;
  elsif v_video = 'enviado' and l.video_sent_at is null then
    update leads set video_sent_at = now(), video_offered_at = coalesce(video_offered_at, now()),
      video_authorized_at = coalesce(video_authorized_at, now()) where id = p_lead;
  else
    v_video := null;
  end if;
  if v_video is not null then
    insert into lead_commercial_events (lead_id, field, old_value, new_value, source, note, created_by)
    values (p_lead, 'video', null, v_video, p_source, v_note, v_uid);
    v_changed := v_changed || '"video"'::jsonb;
  end if;

  -- Estratégia (só o Marcos troca à mão; o envio grava a da mensagem).
  if v_strat is not null and v_strat is distinct from l.prospect_strategy and p_source <> 'auto' then
    insert into lead_commercial_events (lead_id, field, old_value, new_value, source, note, created_by)
    values (p_lead, 'estrategia', l.prospect_strategy, v_strat, p_source, v_note, v_uid);
    update leads set prospect_strategy = v_strat where id = p_lead;
    v_changed := v_changed || '"estrategia"'::jsonb;
  end if;

  if v_loss is not null and v_loss is distinct from l.loss_reason and p_source <> 'auto' then
    insert into lead_commercial_events (lead_id, field, old_value, new_value, source, note, created_by)
    values (p_lead, 'motivo_perda', l.loss_reason, left(v_loss, 500), p_source, v_note, v_uid);
    update leads set loss_reason = left(v_loss, 500) where id = p_lead;
    v_changed := v_changed || '"motivo_perda"'::jsonb;
  end if;

  -- Acompanhamento: o Hermes só sugere quando não há retorno marcado.
  if v_follow is not null and v_follow is distinct from l.next_follow_up_at
     and (p_source = 'marcos' or (p_source = 'hermes' and l.next_follow_up_at is null)) then
    insert into lead_commercial_events (lead_id, field, old_value, new_value, source, note, created_by)
    values (p_lead, 'acompanhamento', l.next_follow_up_at::text, v_follow::text, p_source, v_note, v_uid);
    update leads set next_follow_up_at = v_follow where id = p_lead;
    v_changed := v_changed || '"acompanhamento"'::jsonb;
  end if;
  return v_changed;
end
$$;
revoke execute on function public.commercial_set(uuid, jsonb, text, text) from public, anon, authenticated;

-- Painel: o Marcos corrige ou registra os campos comerciais.
create or replace function public.admin_update_commercial(p_lead uuid, p jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  return commercial_set(p_lead, p, 'marcos', nullif(btrim(coalesce(p ->> 'nota', '')), ''));
end
$$;
revoke execute on function public.admin_update_commercial(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_commercial(uuid, jsonb) to authenticated;

-- Hermes (secretário): registra o que percebeu na conversa.
create or replace function public.api_commercial_update(p_token uuid, p_lead uuid, p jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if not exists (select 1 from leads where id = p_lead) then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('lead não encontrado'));
  end if;
  return jsonb_build_object('status', 'ok', 'mudou', commercial_set(p_lead, p - 'estrategia' - 'motivo_perda', 'hermes',
    nullif(btrim(coalesce(p ->> 'nota', '')), '')));
end
$$;
revoke execute on function public.api_commercial_update(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.api_commercial_update(uuid, uuid, jsonb) to service_role;

-- Resposta classificada pela API (intenção e papel): grava na resposta e
-- avança o lead. Pedido para parar ou sem interesse encerra.
create or replace function public.api_reply_annotate(p_token uuid, p_reply uuid, p jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r outreach_replies;
  v_intent text := nullif(p ->> 'intencao', '');
  v_role text := nullif(p ->> 'papel', '');
  v_changed jsonb;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  select * into r from outreach_replies where id = p_reply;
  if not found then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('resposta não encontrada'));
  end if;
  if v_intent is not null and v_intent not in ('positiva', 'neutra', 'negativa', 'automatica', 'esclarecimento', 'encaminhamento') then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('intenção inválida'));
  end if;
  -- A classificação de pessoa/robô do banco vale mais que a da intenção.
  if r.kind = 'automatica' then
    v_intent := 'automatica';
    v_role := 'automatico';
  elsif v_intent = 'automatica' then
    v_intent := 'neutra';
    v_role := nullif(v_role, 'automatico');
  end if;
  update outreach_replies set intent = v_intent, contact_role = v_role where id = r.id;
  if r.kind = 'automatica' then
    -- Atendimento automático só registra o papel quando nada foi identificado.
    v_changed := commercial_set(r.lead_id, jsonb_build_object('papel_contato', 'automatico'), 'auto', 'resposta automática');
  else
    v_changed := commercial_set(r.lead_id, jsonb_strip_nulls(jsonb_build_object(
      'estado', case when r.opt_out then 'encerrado' else coalesce(nullif(p ->> 'estado', ''), 'resposta_recebida') end,
      'papel_contato', v_role,
      'interesse', case when r.opt_out then 'nenhum' else nullif(p ->> 'interesse', '') end,
      'video', nullif(p ->> 'video', ''))), 'auto', left(coalesce(nullif(p ->> 'motivo', ''), 'resposta classificada'), 500));
  end if;
  return jsonb_build_object('status', 'ok', 'mudou', v_changed);
end
$$;
revoke execute on function public.api_reply_annotate(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.api_reply_annotate(uuid, uuid, jsonb) to service_role;

-- Saudação confirmada: estado 1 (primeiro contato).
create or replace function public.outreach_greeting_commercial() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform commercial_set(new.lead_id, jsonb_build_object('estado', 'primeiro_contato'), 'auto', 'saudação enviada');
  return new;
end
$$;
create trigger outreach_messages_commercial
after update of greeting_sent_at on public.outreach_messages
for each row when (old.greeting_sent_at is null and new.greeting_sent_at is not null)
execute function public.outreach_greeting_commercial();

-- Quantos leads já pegaram cada estratégia, por grupo de leads parecidos.
create or replace function public.api_outreach_strategy_counts(p_token uuid) returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select case when p_token is null then null else coalesce(jsonb_agg(jsonb_build_object(
    'estrategia', x.strategy, 'estrato', x.strategy_stratum, 'n', x.n)), '[]'::jsonb) end
  from (select strategy, strategy_stratum, count(*)::int as n from outreach_messages
        where strategy is not null and status <> 'cancelada' group by 1, 2) x
$$;
revoke execute on function public.api_outreach_strategy_counts(uuid) from public, anon, authenticated;
grant execute on function public.api_outreach_strategy_counts(uuid) to service_role;

-- Grava a mensagem preparada com a estratégia (A/B/C), quando vier.
-- Igual à versão dos estilos, mais as colunas da estratégia.
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
  v_strat text := nullif(p ->> 'estrategia', '');
  v_mode text := nullif(p ->> 'modo_estrategia', '');
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if v_strat is not null and v_strat not in ('A', 'B', 'C') then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('estratégia inválida (use A, B ou C)'));
  end if;
  if v_mode is not null and v_mode not in ('teste', 'recomendada') then
    v_mode := null;
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
  insert into outreach_messages (lead_id, phone_e164, compliment, pain, improvement, body, style,
    strategy, strategy_reason, strategy_stratum, strategy_mode)
  values (p_lead, v_lead.phone_e164, p ->> 'elogio', p ->> 'dor', p ->> 'melhoria', p ->> 'mensagem', v_style,
    v_strat, left(nullif(p ->> 'motivo_estrategia', ''), 300), left(nullif(p ->> 'estrato', ''), 60),
    case when v_strat is null then null else v_mode end)
  returning id into v_id;
  update leads set outreach_failures = 0, outreach_last_error = null, outreach_last_error_at = null where id = p_lead;
  if v_strat is not null and v_strat is distinct from v_lead.prospect_strategy then
    insert into lead_commercial_events (lead_id, field, old_value, new_value, source, note)
    values (p_lead, 'estrategia', v_lead.prospect_strategy, v_strat, 'hermes', left(nullif(p ->> 'motivo_estrategia', ''), 500));
    update leads set prospect_strategy = v_strat where id = p_lead;
  end if;
  return jsonb_build_object('status', 'criado', 'message_id', v_id, 'estilo', v_style, 'estrategia', v_strat);
end
$$;

-- Trava de aprovação: só o Marcos liga e desliga.
create or replace function public.admin_outreach_require_approval(p_on boolean) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update outreach_settings set require_approval = coalesce(p_on, false), updated_at = now(), updated_by = auth.uid() where id = 1;
end
$$;
revoke execute on function public.admin_outreach_require_approval(boolean) from public, anon;
grant execute on function public.admin_outreach_require_approval(boolean) to authenticated;

-- Aprovar: 'mensagem' (saudação + texto preparado), 'texto' (texto escrito
-- depois de ler a resposta) ou 'resposta' (secretário).
create or replace function public.admin_outreach_approve(p_kind text, p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  if p_kind = 'mensagem' then
    update outreach_messages set approved_at = now(), approved_by = auth.uid(),
      body_approved_at = case when style = 'agradecimento' then now() else body_approved_at end
    where id = p_id and status = 'pronta' and approved_at is null;
  elsif p_kind = 'texto' then
    update outreach_messages set body_approved_at = now(), approved_by = auth.uid(),
      approved_at = coalesce(approved_at, now())
    where id = p_id and status = 'saudacao_enviada' and (reply_body_at is not null or style = 'agradecimento')
      and body_approved_at is null;
  elsif p_kind = 'resposta' then
    update outreach_secretary set approved_at = now(), approved_by = auth.uid()
    where id = p_id and status = 'pronta' and approved_at is null;
  else
    raise exception 'tipo inválido' using errcode = '22023';
  end if;
  if not found then
    raise exception 'já saiu, foi cancelada ou já estava aprovada' using errcode = '22023';
  end if;
end
$$;
revoke execute on function public.admin_outreach_approve(text, uuid) from public, anon;
grant execute on function public.admin_outreach_approve(text, uuid) to authenticated;

-- Recusar: a mensagem ainda na fila é cancelada (o Hermes escreve outra na
-- próxima rodada); depois da saudação, o texto preparado é cancelado e o
-- "lendo a resposta" volta para o Hermes reescrever; a resposta do secretário
-- é cancelada e ele responde de novo.
create or replace function public.admin_outreach_reject(p_kind text, p_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'recusada pelo Marcos'), 300);
begin
  perform require_admin();
  if p_kind = 'mensagem' then
    update outreach_messages set status = 'cancelada', cancelled_at = now(), cancel_reason = 'recusada pelo Marcos: ' || v_reason
    where id = p_id and status = 'pronta';
  elsif p_kind = 'texto' then
    -- Texto preparado (a saudação já saiu): cancela, nada mais é enviado.
    update outreach_messages set status = 'cancelada', cancelled_at = now(), cancel_reason = 'recusada pelo Marcos: ' || v_reason
    where id = p_id and status = 'saudacao_enviada' and style = 'agradecimento' and sent_at is null;
    if not found then
      -- "Lendo a resposta": volta para o Hermes escrever de novo.
      update outreach_messages set body = coalesce(template_body, body), reply_body_at = null, body_approved_at = null
      where id = p_id and status = 'saudacao_enviada' and style = 'lendo_resposta' and reply_body_at is not null and sent_at is null;
    end if;
  elsif p_kind = 'resposta' then
    update outreach_secretary set status = 'cancelada', cancelled_at = now(), cancel_reason = 'recusada pelo Marcos: ' || v_reason
    where id = p_id and status = 'pronta';
  else
    raise exception 'tipo inválido' using errcode = '22023';
  end if;
  if not found then
    raise exception 'já saiu ou já foi cancelada' using errcode = '22023';
  end if;
end
$$;
revoke execute on function public.admin_outreach_reject(text, uuid, text) from public, anon;
grant execute on function public.admin_outreach_reject(text, uuid, text) to authenticated;

-- Envio: igual à versão dos estilos, mais a trava de aprovação. Com a trava
-- desligada (padrão) o comportamento é idêntico ao anterior.
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
             -- Trava de aprovação: o texto só sai depois do clique do Marcos.
             and (not s.require_approval or body_approved_at is not null)
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
    where x.status = 'pronta' and (not s.require_approval or x.approved_at is not null)
    order by x.due_at limit 1;
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
  where o.status = 'pronta' and (not s.require_approval or o.approved_at is not null)
  order by o.created_at
  limit 1;
  if not found then
    if s.require_approval and exists (select 1 from outreach_messages where status = 'pronta') then
      return jsonb_build_object('status', 'aguardando_aprovacao');
    end if;
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


-- Comparação das estratégias. "antiga" = mensagens de antes do teste A/B/C.
-- Contatado = saudação confirmada pelo enviador; a mensagem da estratégia só
-- sai depois que uma pessoa responde.
create view public.strategy_metrics with (security_invoker = true) as
select coalesce(o.strategy, 'antiga') as estrategia,
  count(*)::int as contatados,
  count(*) filter (where o.sent_at is not null)::int as mensagens_entregues,
  count(*) filter (where exists (select 1 from outreach_replies r where r.lead_id = l.id and r.kind = 'humana'))::int as respostas_humanas,
  count(*) filter (where exists (select 1 from outreach_replies r where r.lead_id = l.id and r.kind = 'automatica'))::int as respostas_automaticas,
  count(*) filter (where exists (select 1 from outreach_replies r where r.lead_id = l.id and r.intent = 'positiva'))::int as respostas_positivas,
  count(*) filter (where l.decision_maker_at is not null)::int as decisores,
  count(*) filter (where l.video_authorized_at is not null)::int as videos_autorizados,
  count(*) filter (where l.video_sent_at is not null)::int as videos_enviados,
  count(*) filter (where l.furthest_state_rank >= 6 or l.commercial_interest in ('medio', 'alto'))::int as interesse,
  count(*) filter (where l.price_question_at is not null or l.proposal_sent_at is not null)::int as propostas_solicitadas,
  count(*) filter (where l.furthest_state_rank >= 7 or l.stage in ('proposta_enviada', 'fechado'))::int as negociacoes,
  count(*) filter (where l.furthest_state_rank >= 8 or l.stage in ('proposta_enviada', 'fechado'))::int as oportunidades,
  count(*) filter (where l.stage = 'fechado')::int as vendas,
  coalesce(sum(l.closed_value) filter (where l.stage = 'fechado'), 0)::numeric(12, 2) as receita
from outreach_messages o
join leads l on l.id = o.lead_id
where o.status <> 'cancelada' and o.greeting_sent_at is not null
group by 1;
grant select on public.strategy_metrics to authenticated;

-- Preenche o estado dos leads já abordados a partir do que já aconteceu
-- (sem apagar nada; cada preenchimento fica no histórico como 'auto').
do $$
declare
  x record;
begin
  for x in
    select l.id,
      case when l.do_not_contact or l.stage in ('sem_interesse', 'desqualificado') then 'encerrado'
           when l.stage in ('proposta_enviada', 'fechado') then 'oportunidade'
           when l.price_question_at is not null then 'negociacao'
           when exists (select 1 from outreach_replies r where r.lead_id = l.id and r.kind = 'humana') then 'resposta_recebida'
           else 'primeiro_contato' end as estado
    from leads l
    where l.conversation_state is null
      and exists (select 1 from outreach_messages o where o.lead_id = l.id and o.greeting_sent_at is not null)
  loop
    perform commercial_set(x.id, jsonb_build_object('estado', x.estado), 'auto', 'preenchido a partir do histórico');
  end loop;
end
$$;
