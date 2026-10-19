-- "Marcar como não lida" estilo WhatsApp: um marcador manual que vale até você abrir a conversa de novo.
alter table public.conversation_reads
  add column if not exists marked_unread boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.mark_conversation_seen(p_lead uuid, p_seen timestamptz) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if not public.is_admin() or auth.uid() is null then raise insufficient_privilege; end if;
  -- Nunca marca como lida uma resposta que chegou depois, nem move o cursor para trás.
  insert into public.conversation_reads(user_id, lead_id, seen_at)
  select auth.uid(), id, least(p_seen, last_in_at, now()) from public.conversation_inbox where id = p_lead and last_in_at is not null
  on conflict (user_id, lead_id) do update
    set seen_at = greatest(conversation_reads.seen_at, excluded.seen_at), marked_unread = false, updated_at = now();
end $$;

create or replace function public.mark_conversation_unread(p_lead uuid) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if not public.is_admin() or auth.uid() is null then raise insufficient_privilege; end if;
  insert into public.conversation_reads(user_id, lead_id, seen_at, marked_unread)
  select auth.uid(), id, last_in_at, true from public.conversation_inbox where id = p_lead and last_in_at is not null
  on conflict (user_id, lead_id) do update set marked_unread = true, updated_at = now();
  if not found then raise exception 'Só dá para marcar como não lida uma conversa em que o cliente já respondeu.' using errcode = '22023'; end if;
end $$;
revoke execute on function public.mark_conversation_unread(uuid) from public, anon;
grant execute on function public.mark_conversation_unread(uuid) to authenticated;

create or replace view public.conversation_unread with (security_invoker = true) as
 select c.id, c.business_name, c.last_in_at, c.last_in_body, c.last_in_media
 from public.conversation_inbox c left join public.conversation_reads r on r.lead_id = c.id and r.user_id = (select auth.uid())
 where c.last_in_at is not null and (r.seen_at is null or c.last_in_at > r.seen_at or r.marked_unread);
