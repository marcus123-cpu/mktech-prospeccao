-- Quando o WhatsApp informa o nome do contato, troca o nome genérico "Contato (11) 99999-0000" dos leads que vieram do WhatsApp.
create or replace function public.api_conversation_history(p jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_lead uuid; v_count integer; v_nome text := btrim(coalesce(p->>'nome', ''));
begin
  select id into v_lead from public.leads
  where phone_e164 = any (public.outreach_phone_variants(p->>'telefone')) order by created_at, id limit 1;
  if v_lead is null then
    v_lead := public.ensure_whatsapp_lead(p->>'telefone', p->>'nome', p->>'direcao' = 'entrada');
  elsif v_nome <> '' and v_nome !~ '^[+0-9 ()\-]+$' then
    update public.leads set business_name = left(v_nome, 200)
    where id = v_lead and source_name = 'WhatsApp' and business_name like 'Contato (%' and norm_text(v_nome) is not null;
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
