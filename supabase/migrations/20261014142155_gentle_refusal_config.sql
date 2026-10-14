alter table public.commercial_settings
  add column objection_recovery_enabled boolean not null default true;

alter function public.admin_commercial_settings(jsonb) rename to admin_commercial_settings_before_refusal;
create function public.admin_commercial_settings(p jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform require_admin();
  perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
  perform admin_commercial_settings_before_refusal(p-'objection_recovery_enabled');
  if p ? 'objection_recovery_enabled' then
    if jsonb_typeof(p->'objection_recovery_enabled') <> 'boolean' then
      raise exception 'Configuração da objeção inválida' using errcode='22023';
    end if;
    update commercial_settings
      set objection_recovery_enabled=(p->>'objection_recovery_enabled')::boolean
      where id=1;
  end if;
end $$;
revoke execute on function public.admin_commercial_settings_before_refusal(jsonb) from public,anon,authenticated,service_role;
revoke execute on function public.admin_commercial_settings(jsonb) from public,anon,service_role;
grant execute on function public.admin_commercial_settings(jsonb) to authenticated;
