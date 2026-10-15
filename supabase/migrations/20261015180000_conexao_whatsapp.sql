-- Aba Conexão: estado do WhatsApp e QR code, enviados pelo enviador do PC.
create table public.whatsapp_connection (
  id integer primary key default 1 check (id = 1),
  ready boolean not null default false,
  phone_number text,
  state text,
  qr text,
  qr_at timestamptz,
  connected_since timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.whatsapp_connection(id) values (1);
alter table public.whatsapp_connection enable row level security;
revoke all on public.whatsapp_connection from anon, authenticated;

create function public.api_whatsapp_connection_set(p_ready boolean, p_number text, p_state text, p_qr text) returns void
language plpgsql security definer set search_path = public as $$
declare old public.whatsapp_connection;
begin
  select * into old from whatsapp_connection where id = 1 for update;
  update whatsapp_connection set
    ready = p_ready, phone_number = coalesce(nullif(left(p_number, 30), ''), phone_number),
    state = left(p_state, 120),
    qr = case when p_ready then null else left(p_qr, 1000) end,
    qr_at = case when p_ready or p_qr is null then null when p_qr is distinct from old.qr then now() else old.qr_at end,
    connected_since = case when p_ready and not old.ready then now() when not p_ready then null else old.connected_since end,
    updated_at = now()
  where id = 1;
end $$;

create function public.admin_whatsapp_connection() returns public.whatsapp_connection
language plpgsql stable security definer set search_path = public as $$
declare r public.whatsapp_connection;
begin
  perform require_admin();
  select * into r from whatsapp_connection where id = 1;
  return r;
end $$;

revoke execute on function public.api_whatsapp_connection_set(boolean, text, text, text) from public, anon, authenticated;
revoke execute on function public.admin_whatsapp_connection() from public, anon, service_role;
grant execute on function public.api_whatsapp_connection_set(boolean, text, text, text) to service_role;
grant execute on function public.admin_whatsapp_connection() to authenticated;
