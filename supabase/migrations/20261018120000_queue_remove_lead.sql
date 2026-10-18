-- Tira um lead da fila de envio: cancela a saudação ainda não enviada (fila antiga e fila V6)
-- e o remove do disparo ativo. Quem já recebeu mensagem não é afetado.
create function public.admin_queue_remove_lead(p_lead uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio', 0));
  perform public.admin_campaign_remove_lead(p_lead);
  update outreach_messages set status = 'cancelada', cancelled_at = now(), cancel_reason = 'removido da fila pelo painel'
    where lead_id = p_lead and status = 'pronta';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.admin_queue_remove_lead(uuid) from public, anon, service_role;
grant execute on function public.admin_queue_remove_lead(uuid) to authenticated;
