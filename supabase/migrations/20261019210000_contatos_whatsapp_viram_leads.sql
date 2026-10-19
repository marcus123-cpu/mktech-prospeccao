-- Contatos do WhatsApp que ainda não são lead passam a aparecer no sistema.
-- Eles entram como atendimento MANUAL (secretary_handoff_at preenchido): o Hermes nunca responde nem inclui em disparo.
create or replace function public.ensure_whatsapp_lead(p_phone text, p_name text, p_incoming boolean default false) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_phone text := norm_phone(p_phone); v_name text; v_digits text;
begin
  if v_phone is null or v_phone !~ '^\+55[1-9][0-9][0-9]{8,9}$' then return null; end if; -- só telefone brasileiro válido
  v_digits := regexp_replace(v_phone, '\D', '', 'g');
  perform pg_advisory_xact_lock(hashtextextended('wa-lead:' || v_digits, 0));
  select id into v_id from leads where phone_e164 = any (outreach_phone_variants(v_phone)) order by created_at, id limit 1;
  if v_id is not null then return v_id; end if;
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' or v_name ~ '^[+0-9 ()\-]+$' or norm_text(v_name) is null then
    v_name := 'Contato ' || regexp_replace(v_phone, '^\+55(\d{2})(\d+)(\d{4})$', '(\1) \2-\3');
  end if;
  insert into leads (business_name, city, state, origin, stage, contacted, contact_date_unknown, phone_raw, source_name,
                     secretary_handoff_at, secretary_handoff_reason, selection_reason)
  values (left(v_name, 200), 'Não informada', 'SP', 'importacao',
          case when p_incoming then 'respondeu'::lead_stage else 'contatado'::lead_stage end, true, true, v_phone, 'WhatsApp',
          now(), 'Contato do WhatsApp: atendimento manual', 'Veio da conversa do WhatsApp')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.ensure_whatsapp_lead(text, text, boolean) from public, anon, authenticated;
grant execute on function public.ensure_whatsapp_lead(text, text, boolean) to service_role;

create or replace function public.api_conversation_history(p jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_lead uuid; v_count integer;
begin
  select id into v_lead from public.leads
  where phone_e164 = any (public.outreach_phone_variants(p->>'telefone')) order by created_at, id limit 1;
  if v_lead is null then
    v_lead := public.ensure_whatsapp_lead(p->>'telefone', p->>'nome', p->>'direcao' = 'entrada');
  end if;
  if v_lead is null then return jsonb_build_object('status', 'ignorada'); end if;
  if p->>'direcao' = 'saida' and p ? 'ack' then
    insert into public.whatsapp_receipts(external_id, lead_id, ack)
    values (p->>'message_id', v_lead, (p->>'ack')::smallint)
    on conflict (external_id) do update set ack = greatest(whatsapp_receipts.ack, excluded.ack), updated_at = now();
  end if;
  insert into public.whatsapp_history(external_id, lead_id, occurred_at, direction, body, media)
  values (p->>'message_id', v_lead, (p->>'ocorrida_em')::timestamptz, p->>'direcao', p->>'texto', p->>'tipo')
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return jsonb_build_object('status', case when v_count = 0 then 'existente' else 'registrada' end);
end $$;
revoke execute on function public.api_conversation_history(jsonb) from public, anon, authenticated;
grant execute on function public.api_conversation_history(jsonb) to service_role;
