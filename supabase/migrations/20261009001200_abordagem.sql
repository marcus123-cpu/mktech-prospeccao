-- Abordagem: rascunhos de mensagem que o Hermes escreve, a partir das
-- evidências e do diagnóstico, para o Marcos revisar e enviar ele mesmo.
-- O Hermes nunca envia nada. Cada geração e cada edição vira uma versão nova;
-- nenhuma versão é sobrescrita. "Usei esta" fica registrado à parte e não
-- marca o lead como contatado (isso continua manual).

create table public.lead_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  batch_id uuid not null,
  parent_id uuid references public.lead_messages (id) on delete set null,
  style text not null check (style in ('direta', 'pulga', 'consultiva')),
  body text not null check (length(body) between 1 and 500),
  pain_used text check (length(pain_used) <= 500),
  evidence_used text check (length(evidence_used) <= 1000),
  risk text check (risk in ('baixo', 'medio', 'alto')),
  alert text check (length(alert) <= 500),
  source text not null check (source in ('hermes', 'edicao')),
  created_by uuid,
  created_at timestamptz not null default now()
);
create index lead_messages_lead_idx on public.lead_messages (lead_id, created_at desc);

create table public.lead_message_uses (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.lead_messages (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  used_at timestamptz not null default now(),
  created_by uuid
);
create index lead_message_uses_lead_idx on public.lead_message_uses (lead_id, used_at desc);

-- Pedido do painel para o Hermes (re)gerar as mensagens na próxima execução.
-- approach_failures conta lotes recusados pela validação; com 3 recusas o
-- lead sai da fila (evita gastar o modelo em loop) até o Marcos pedir de novo.
alter table public.leads add column approach_requested_at timestamptz;
alter table public.leads add column approach_failures integer not null default 0;

alter table public.lead_messages enable row level security;
alter table public.lead_message_uses enable row level security;
revoke all on public.lead_messages, public.lead_message_uses from anon, authenticated;
grant select on public.lead_messages, public.lead_message_uses to authenticated;
create policy admin_le on public.lead_messages for select to authenticated using (public.is_admin());
create policy admin_le on public.lead_message_uses for select to authenticated using (public.is_admin());

-- Painel: salva o texto editado como versão nova (a anterior fica intacta).
create or replace function public.admin_save_message_version(p_parent uuid, p_body text) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent lead_messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  perform require_admin();
  select * into v_parent from lead_messages where id = p_parent;
  if not found then
    raise exception 'mensagem não encontrada' using errcode = 'P0002';
  end if;
  if v_body = '' or length(v_body) > 500 then
    raise exception 'a mensagem precisa ter entre 1 e 500 caracteres' using errcode = '22023';
  end if;
  if v_body = v_parent.body then
    return v_parent.id;
  end if;
  insert into lead_messages (lead_id, batch_id, parent_id, style, body, pain_used, evidence_used, risk, alert, source, created_by)
  values (v_parent.lead_id, v_parent.batch_id, v_parent.id, v_parent.style, v_body, v_parent.pain_used,
          v_parent.evidence_used, v_parent.risk, v_parent.alert, 'edicao', auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.admin_mark_message_used(p_message uuid) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid;
  v_id uuid;
begin
  perform require_admin();
  select lead_id into v_lead from lead_messages where id = p_message;
  if v_lead is null then
    raise exception 'mensagem não encontrada' using errcode = 'P0002';
  end if;
  insert into lead_message_uses (message_id, lead_id, created_by) values (p_message, v_lead, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.admin_request_approach(p_lead uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update leads set approach_requested_at = now(), approach_failures = 0 where id = p_lead;
end
$$;

-- Contexto que o Hermes pode usar para escrever (e que a API usa para
-- validar): dados cadastrais, último diagnóstico, evidências e as últimas
-- observações manuais do Marcos (correções dele valem como fato).
create or replace function public.lead_approach_context(p_lead uuid) returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'lead_id', l.id,
    'business_name', l.business_name,
    'responsible_name', l.responsible_name,
    'niche', l.niche,
    'city', l.city,
    'state', l.state,
    'neighborhood', l.neighborhood,
    'services', to_jsonb(l.services),
    'site_status', l.site_status,
    'verificacao_pendente', l.site_status = 'verificacao_pendente',
    'pending_items', l.pending_items,
    'website_url', l.website_url,
    'instagram_handle', l.instagram_handle,
    'phone_e164', l.phone_e164,
    'selection_reason', l.selection_reason,
    'diagnosis', (
      select jsonb_build_object(
        'fit_score', d.fit_score, 'confidence', d.confidence, 'summary', d.summary,
        'digital_presence', d.digital_presence, 'pains', d.pains, 'opportunities', to_jsonb(d.opportunities),
        'offer', d.offer, 'offer_reason', d.offer_reason, 'approach', d.approach, 'objections', to_jsonb(d.objections))
      from lead_diagnoses d where d.lead_id = l.id order by d.created_at desc limit 1),
    'evidences', coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'url', e.url, 'summary', e.summary,
                                          'observed_at', e.observed_at, 'limitation', e.limitation)
                       order by e.observed_at desc)
      from lead_evidences e where e.lead_id = l.id), '[]'),
    'notes', coalesce((
      select jsonb_agg(n.body order by n.created_at desc)
      from (select body, created_at from lead_notes where lead_id = l.id and source = 'manual'
            order by created_at desc limit 5) n), '[]')
  )
  from leads l where l.id = p_lead
$$;

-- Hermes: leads que precisam de mensagens (pedidos do painel primeiro, depois
-- leads novos com diagnóstico e sem nenhuma mensagem).
create or replace function public.api_pending_approach(p_token uuid, p_limit integer) returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object('status', 'ok', 'leads', coalesce(jsonb_agg(lead_approach_context(x.id) order by x.ord), '[]'))
  from (
    select l.id, row_number() over (order by l.approach_requested_at is null, l.fit_score desc nulls last, l.created_at) as ord
    from leads l
    where p_token is not null
      and l.approach_failures < 3
      and (l.approach_requested_at is not null
           or (l.stage = 'novo' and not l.contacted
               and exists (select 1 from lead_diagnoses d where d.lead_id = l.id)
               and not exists (select 1 from lead_messages m where m.lead_id = l.id)))
    order by ord
    limit least(greatest(coalesce(p_limit, 5), 1), 20)
  ) x
$$;

create or replace function public.api_approach_context(p_token uuid, p_lead uuid) returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select case when p_token is null then null else lead_approach_context(p_lead) end
$$;

create or replace function public.api_note_approach_failure(p_token uuid, p_lead uuid) returns void
language sql
security definer
set search_path = public
as $$
  update leads set approach_failures = approach_failures + 1 where id = p_lead and p_token is not null
$$;

-- Hermes: grava um lote de variantes já validadas pela API. Se o último lote
-- do Hermes para o lead tiver exatamente os mesmos textos (reenvio após falha
-- de rede), não duplica.
create or replace function public.api_save_approach(p_token uuid, p_lead uuid, p jsonb) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_last uuid;
  v jsonb;
begin
  if p_token is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  if not exists (select 1 from leads where id = p_lead) then
    return jsonb_build_object('status', 'invalido', 'errors', jsonb_build_array('lead não encontrado'));
  end if;

  select batch_id into v_last from lead_messages
  where lead_id = p_lead and source = 'hermes' order by created_at desc limit 1;
  if v_last is not null and (
    select array_agg(body order by body) from lead_messages where batch_id = v_last and source = 'hermes'
  ) = (
    select array_agg(x ->> 'mensagem' order by x ->> 'mensagem') from jsonb_array_elements(p -> 'variantes') x
  ) then
    update leads set approach_requested_at = null, approach_failures = 0 where id = p_lead;
    return jsonb_build_object('status', 'existente', 'batch_id', v_last);
  end if;

  for v in select * from jsonb_array_elements(p -> 'variantes') loop
    insert into lead_messages (lead_id, batch_id, style, body, pain_used, evidence_used, risk, alert, source)
    values (p_lead, v_batch, v ->> 'estilo', v ->> 'mensagem', nullif(v ->> 'dor_usada', ''),
            nullif(v ->> 'evidencia_usada', ''), v ->> 'risco', nullif(p ->> 'alerta', ''), 'hermes');
  end loop;
  update leads set approach_requested_at = null, approach_failures = 0 where id = p_lead;
  return jsonb_build_object('status', 'criado', 'batch_id', v_batch,
                            'count', jsonb_array_length(p -> 'variantes'));
end
$$;

revoke execute on function
  public.admin_save_message_version(uuid, text),
  public.admin_mark_message_used(uuid),
  public.admin_request_approach(uuid),
  public.lead_approach_context(uuid),
  public.api_pending_approach(uuid, integer),
  public.api_approach_context(uuid, uuid),
  public.api_note_approach_failure(uuid, uuid),
  public.api_save_approach(uuid, uuid, jsonb)
from public, anon, authenticated;

grant execute on function
  public.admin_save_message_version(uuid, text),
  public.admin_mark_message_used(uuid),
  public.admin_request_approach(uuid)
to authenticated;

grant execute on function
  public.api_pending_approach(uuid, integer),
  public.api_approach_context(uuid, uuid),
  public.api_note_approach_failure(uuid, uuid),
  public.api_save_approach(uuid, uuid, jsonb)
to service_role;
