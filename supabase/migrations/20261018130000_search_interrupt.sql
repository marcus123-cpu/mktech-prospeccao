-- Interrompe a pesquisa do Hermes em andamento: encerra a execução como abandonada
-- (o servidor passa a recusar novos cadastros dela) e fecha o pedido como cancelado.
-- O que já foi cadastrado fica no sistema.
create function public.admin_search_interrupt(p_id uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare q hermes_requests; found_n integer := 0;
begin
  perform require_admin();
  select * into q from hermes_requests where id = p_id and status = 'em_andamento' for update;
  if not found then
    raise exception 'Não há pesquisa em andamento para interromper.' using errcode = '22023';
  end if;
  if q.run_id is not null then
    found_n := public.hermes_run_qualified(q.run_id);
    update hermes_runs set status = 'abandonada', finished_at = now(), end_reason = 'interrompida no painel'
      where id = q.run_id and status = 'em_andamento';
  end if;
  update hermes_requests set status = 'cancelado', finished_at = now(), qualified_found = found_n, note = 'interrompido no painel'
    where id = p_id;
  return found_n;
end $$;
revoke execute on function public.admin_search_interrupt(uuid) from public, anon, service_role;
grant execute on function public.admin_search_interrupt(uuid) to authenticated;
