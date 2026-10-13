-- Guarda o conteúdo das mensagens escritas no celular do chip para que o
-- histórico e as respostas futuras tenham o contexto real da conversa.
alter table public.outreach_outbound
  add column body text check (length(body) <= 4000),
  add column media text not null default 'texto' check (media in ('texto', 'audio', 'imagem', 'outro')),
  add column external_id text check (length(external_id) <= 200);

drop index public.outreach_outbound_uq;
create unique index outreach_outbound_legacy_uq on public.outreach_outbound (phone_e164, sent_at)
  where external_id is null;
create unique index outreach_outbound_external_uq on public.outreach_outbound (external_id)
  where external_id is not null;

create or replace function public.api_outreach_outbound(p_token uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phones text[] := outreach_phone_variants(p ->> 'phone_e164');
  v_at timestamptz := coalesce(nullif(p ->> 'sent_at', '')::timestamptz, now());
  v_body text := nullif(p ->> 'body', '');
  v_media text := coalesce(nullif(p ->> 'media', ''), 'texto');
  v_external_id text := nullif(p ->> 'external_id', '');
  m outreach_messages;
  v_id uuid;
begin
  if p_token is null then raise exception 'token inválido' using errcode = '28000'; end if;
  if length(v_body) > 4000 or length(v_external_id) > 200 or v_media not in ('texto', 'audio', 'imagem', 'outro') then
    raise exception 'mensagem manual inválida' using errcode = '22023';
  end if;
  select * into m from outreach_messages
  where phone_e164 = any (v_phones) and greeting_sent_at is not null
  order by greeting_sent_at desc limit 1;
  if not found then
    return jsonb_build_object('status', 'ignorada', 'motivo', 'telefone não recebeu abordagem automática');
  end if;
  insert into outreach_outbound (lead_id, phone_e164, sent_at, body, media, external_id)
  values (m.lead_id, m.phone_e164, v_at, v_body, v_media, v_external_id)
  on conflict do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('status', 'existente', 'lead_id', m.lead_id); end if;
  return jsonb_build_object('status', 'registrada', 'lead_id', m.lead_id);
end $$;

create or replace view public.conversation_timeline with (security_invoker = true) as
select id::text || ':saudacao' as id, lead_id, greeting_sent_at as occurred_at,
  'saida'::text as direction, 'saudacao'::text as source, greeting as body, 'texto'::text as media
from public.outreach_messages where greeting_sent_at is not null
union all select id::text || ':mensagem', lead_id, sent_at, 'saida', 'abordagem', body, 'texto'
from public.outreach_messages where sent_at is not null
union all select id::text || ':secretario', lead_id, sent_at, 'saida', 'secretario', body, 'texto'
from public.outreach_secretary where status = 'enviada'
union all select id::text || ':lembrete', lead_id, sent_at, 'saida', 'lembrete', body, 'texto'
from public.outreach_followups where status = 'enviado'
union all select id::text || ':cliente', lead_id, received_at, 'entrada', kind, body, media
from public.outreach_replies
union all select id::text || ':manual', lead_id, sent_at, 'saida', 'manual', body, media
from public.outreach_outbound;

-- O secretário recebe a mesma linha do tempo que o painel. Mensagens antigas
-- sem conteúdo ficam identificadas como desconhecidas, sem texto inventado.
create or replace function public.api_secretary_pending(p_token uuid, p_limit integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb; conversations jsonb;
begin
  result := api_secretary_pending_v1(p_token, p_limit);
  select coalesce(jsonb_agg(c || jsonb_build_object(
    'memory', coalesce(to_jsonb(mem) - 'updated_by', '{}'::jsonb),
    'memory_ref', mem.updated_at,
    'conversa', coalesce((
      select jsonb_agg(jsonb_build_object(
        'de', case when t.direction = 'saida' then 'marcos' else 'cliente' end,
        'texto', case when t.body is not null then t.body
          when t.source = 'manual' then '[mensagem enviada no celular; conteúdo antigo indisponível]'
          else '[' || t.media || ']' end,
        'em', t.occurred_at) order by t.occurred_at, t.id)
      from (select * from conversation_timeline h
        where h.lead_id = (c->>'lead_id')::uuid
          and (h.direction = 'saida' or h.source = 'humana')
        order by h.occurred_at desc, h.id desc limit 40) t
    ), '[]'::jsonb)
  )), '[]'::jsonb) into conversations
  from jsonb_array_elements(result->'conversas') c
  left join lead_conversation_memory mem on mem.lead_id = (c->>'lead_id')::uuid;
  return jsonb_set(result, '{conversas}', conversations);
end $$;
