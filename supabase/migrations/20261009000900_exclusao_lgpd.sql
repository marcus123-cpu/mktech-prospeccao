-- Exclusão a pedido do titular (LGPD). Só o administrador; o Hermes não pode.
create or replace function public.admin_delete_lead(p_lead uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform require_admin();
  if nullif(btrim(p_reason), '') is null then
    raise exception 'informe o motivo da exclusão' using errcode = '22023';
  end if;
  delete from leads where id = p_lead;
end
$$;

revoke execute on function public.admin_delete_lead(uuid, text) from public, anon;
grant execute on function public.admin_delete_lead(uuid, text) to authenticated;
