-- Funil (kanban) do envio automático: em que coluna cada lead está.
-- Pergunta de valor: quando uma PESSOA pergunta preço, o lead vai para a
-- coluna "Pergunta de valor" e fica para o Marcos responder. Ninguém responde
-- o cliente automaticamente; o kanban só mostra.

alter table public.outreach_replies add column asks_price boolean not null default false;
-- Cliente mandou áudio: o Marcos é avisado para mudar o estilo da conversa.
alter table public.outreach_replies add column media text not null default 'texto'
  check (media in ('texto', 'audio', 'imagem', 'outro'));
alter table public.leads add column price_question_at timestamptz;

-- Mesma função de antes, agora guardando a pergunta de valor.
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
    where lead_id = m.lead_id and status in ('pronta', 'saudacao_enviada');
  end if;
  if v_kind = 'humana' then
    select stage into v_stage from leads where id = m.lead_id;
    if v_stage in ('novo', 'contatado') then
      perform set_stage(m.lead_id, 'respondeu', 'respondeu à abordagem automática', 'envio');
    end if;
    if v_price then
      update leads set price_question_at = coalesce(price_question_at, v_at) where id = m.lead_id;
    end if;
  end if;
  return jsonb_build_object('status', 'registrada', 'reply_id', v_id, 'lead_id', m.lead_id, 'kind', v_kind,
    'conversa', v_kind = 'humana', 'opt_out', v_opt, 'pergunta_valor', v_price, 'audio', v_media = 'audio');
end
$$;

-- Corrigir a classificação também acerta a pergunta de valor.
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

-- "Já respondi o valor": o lead sai de "Pergunta de valor" e volta para "Em conversa".
create or replace function public.admin_clear_price_question(p_lead uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  update leads set price_question_at = null where id = p_lead;
end
$$;

-- Uma linha por lead que está no funil, com a coluna calculada. Respeita o
-- RLS de quem consulta (só admin enxerga).
create view public.outreach_funnel
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
           when o.status in ('saudacao_enviada', 'enviando_mensagem', 'enviada') then 'enviado'
           when o.status in ('pronta', 'enviando_saudacao') then 'fila'
           when o.status = 'falhou' then 'atencao'
         end as coluna,
         greatest(l.updated_at, o.created_at, o.greeting_sent_at, o.sent_at, r.received_at) as movido_em
  from public.leads l
  left join lateral (
    select * from public.outreach_messages x where x.lead_id = l.id and x.status <> 'cancelada'
    order by x.created_at desc limit 1
  ) o on true
  left join lateral (
    select * from public.outreach_replies y where y.lead_id = l.id order by y.received_at desc limit 1
  ) r on true
  where o.id is not null or l.stage in ('respondeu', 'interessado', 'proposta_enviada', 'fechado');

revoke all on public.outreach_funnel from anon, authenticated;
grant select on public.outreach_funnel to authenticated;

revoke execute on function public.admin_clear_price_question(uuid) from public, anon, authenticated;
grant execute on function public.admin_clear_price_question(uuid) to authenticated;
