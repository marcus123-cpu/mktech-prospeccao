-- One database round trip for the chat, messages and available voice files.
create function public.admin_conversation_detail(p_lead uuid,p_limit integer default 300) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if not public.is_admin() then raise exception 'Acesso negado' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 300 then raise exception 'Limite inválido' using errcode='22023'; end if;
 return (with events as materialized (
   select * from public.conversation_timeline where lead_id=p_lead order by occurred_at desc,id desc limit p_limit
 ) select jsonb_build_object(
   'current',(select to_jsonb(c) from public.conversation_inbox c where c.id=p_lead),
   'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id desc) from events e),'[]'),
   'audio_ids',coalesce((select jsonb_agg(distinct a.external_id) from public.chat_audio a join events e on e.external_id=a.external_id where e.media='audio'),'[]')
 ));
end $$;
revoke all on function public.admin_conversation_detail(uuid,integer) from public,anon,service_role;
grant execute on function public.admin_conversation_detail(uuid,integer) to authenticated;
