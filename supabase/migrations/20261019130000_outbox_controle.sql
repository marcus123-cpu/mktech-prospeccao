-- Controle manual da fila de envio: reenviar, cancelar ou marcar como enviada.
-- "reenviar" cria uma mensagem nova (a ponte guarda o id antigo como "sem confirmação" e nunca o reenviaria).
create or replace function public.admin_outbox_action(p_ids uuid[], p_action text)
returns integer language plpgsql security definer set search_path = public as $$
declare b commercial_outbox; n integer := 0;
begin
  perform require_admin();
  if p_action not in ('retry','cancel','sent') then raise exception 'Ação inválida.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  for b in select * from commercial_outbox where id = any(p_ids) for update loop
    if p_action = 'cancel' then
      if b.status in ('enfileirada','desconhecido','falhou') then
        update commercial_outbox set status='cancelada', error='Cancelado no painel' where id=b.id; n := n + 1;
      end if;
    elsif p_action = 'retry' then
      if b.status in ('desconhecido','falhou') and not b.simulated then
        update commercial_outbox set status='cancelada', error='Substituída por novo envio no painel' where id=b.id;
        insert into commercial_outbox(lead_id, decision_id, idempotency_key, kind, body, phone_e164, demonstration_id, test_run_id, status, due_at)
        values (b.lead_id, b.decision_id, b.idempotency_key||':reenvio:'||gen_random_uuid()::text, b.kind, b.body, b.phone_e164, b.demonstration_id, b.test_run_id, 'enfileirada', now());
        n := n + 1;
      end if;
    else -- sent: você conferiu no WhatsApp que a mensagem saiu
      if b.status in ('desconhecido','falhou') then
        update commercial_outbox set status='enviada', provider_id='manual:'||b.id::text, error=null, sent_at=coalesce(sent_at, now()) where id=b.id;
        insert into contact_events(lead_id, occurred_at, channel, note, source) values (b.lead_id, now(), 'whatsapp', 'Marcada como enviada no painel: '||b.kind, 'envio');
        if b.kind = 'initial' then
          update commercial_leads set stage='CONTATO_ENVIADO' where lead_id=b.lead_id;
          if (select stage from leads where id=b.lead_id)='novo' then perform set_stage(b.lead_id,'contatado','Marcada como enviada no painel','envio'); end if;
        end if;
        n := n + 1;
      end if;
    end if;
  end loop;
  -- Reenvio imediato: libera o intervalo entre envios.
  if p_action = 'retry' and n > 0 then update outreach_settings set next_send_at = now() where id=1; end if;
  return n;
end $$;
revoke all on function public.admin_outbox_action(uuid[], text) from public;
grant execute on function public.admin_outbox_action(uuid[], text) to authenticated;

-- Quantos novos contatos podem sair hoje (horário de São Paulo).
create or replace function public.admin_send_today_target(p integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  if p < 1 or p > 500 then raise exception 'Informe de 1 a 500.' using errcode='22023'; end if;
  update outreach_settings set today_new_leads_target = p, today_new_leads_date = (now() at time zone 'America/Sao_Paulo')::date, updated_at = now() where id = 1;
end $$;

-- Volta a enviar: tira a pausa geral e reativa os disparos pausados.
create or replace function public.admin_send_resume() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; c uuid;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  update outreach_settings set paused = false, enabled = true, next_send_at = now(), updated_at = now() where id = 1;
  for c in select id from commercial_campaigns where status = 'pausada' and mode = 'autonomo' loop
    update commercial_campaigns set status = 'ativa', updated_at = now() where id = c; n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.admin_send_today_target(integer), public.admin_send_resume() from public;
grant execute on function public.admin_send_today_target(integer), public.admin_send_resume() to authenticated;
