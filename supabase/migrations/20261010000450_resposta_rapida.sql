-- Resposta que chega até 15 segundos depois da saudação não é pessoa: é
-- atendimento automático (secretária virtual, menu). Só uma resposta mais lenta
-- libera o texto personalizado. Pedido para parar continua valendo sempre.

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
  v_reason text := p ->> 'reason';
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

  -- Resposta até 15 segundos depois da saudação (a confirmação do envio pode
  -- chegar depois da resposta), ou mensagem sem texto nenhum (evento do
  -- WhatsApp Business): não é uma pessoa. Conta como automática.
  if v_kind = 'humana' and not v_opt
     and (v_at <= m.greeting_sent_at + interval '15 seconds'
          or (v_media = 'outro' and p ->> 'body' = '[mensagem sem texto]')) then
    v_kind := 'automatica';
    v_price := false;
    v_reason := 'chegou até 15 s depois da saudação ou veio sem texto: não é uma pessoa';
  end if;

  insert into outreach_replies (lead_id, message_id, phone_e164, body, received_at, kind, reason, opt_out, asks_price, media)
  values (m.lead_id, m.id, m.phone_e164, left(p ->> 'body', 4000), v_at, v_kind, left(v_reason, 500), v_opt, v_price, v_media)
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
    update outreach_messages set held_at = coalesce(held_at, v_at), held_reason = left(v_reason, 500)
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
