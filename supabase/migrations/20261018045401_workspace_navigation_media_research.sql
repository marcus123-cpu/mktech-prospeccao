-- Dashboard agregado no banco, sem limite de linhas do cliente.
create function public.admin_lead_dashboard() returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 perform require_admin();
 return (select coalesce(jsonb_agg(to_jsonb(n) order by n.total desc),'[]') from (
 select coalesce(nullif(btrim(niche),''),'Sem nicho') as niche,count(*) as total,
 count(*) filter(where contacted) as contacted,count(*) filter(where not contacted) as uncontacted,
 count(*) filter(where phone_e164 is null and instagram_handle is not null) as instagram_only,
 count(*) filter(where phone_e164 ~ '^\+55[0-9]{10}$') as landline,
 count(*) filter(where phone_e164 is null) as no_phone from leads group by 1) n);
end $$;
revoke all on function public.admin_lead_dashboard() from public,anon;
grant execute on function public.admin_lead_dashboard() to authenticated;

alter table public.hermes_requests add column observations text not null default '' check(length(observations)<=3000);
create function public.admin_search_request_v3(p_target integer,p_niche text,p_scope text,p_state text,p_city text,p_observations text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
 perform require_admin();
 if length(coalesce(p_observations,''))>3000 then raise exception 'OBS com até 3000 caracteres' using errcode='22023'; end if;
 v_id:=admin_search_request_v2(p_target,p_niche,p_scope,p_state,p_city);
 update hermes_requests set observations=btrim(coalesce(p_observations,'')) where id=v_id;
 return v_id;
end $$;
revoke all on function public.admin_search_request_v3(integer,text,text,text,text,text) from public,anon;
grant execute on function public.admin_search_request_v3(integer,text,text,text,text,text) to authenticated;
create or replace function public.hermes_request_scope(p_request uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('niche',q.niche,'location_scope',q.location_scope,'location_state',q.location_state,'location_city',q.location_city,'observations',q.observations) from hermes_requests q where q.id=p_request
$$;

insert into storage.buckets(id,name,public,file_size_limit) values('chat-attachments','chat-attachments',false,31457280) on conflict(id) do nothing;
create table public.chat_attachments(
 id uuid primary key,lead_id uuid not null references public.leads(id) on delete cascade,
 storage_path text not null unique,filename text not null check(length(filename) between 1 and 180),
 mime text not null,bytes integer not null check(bytes between 1 and 31457280),
 created_at timestamptz not null default now()
);
alter table public.chat_attachments enable row level security;
revoke all on public.chat_attachments from public,anon,authenticated;
grant select on public.chat_attachments to authenticated;
grant all on public.chat_attachments to service_role;
create policy admin_attachment_read on public.chat_attachments for select to authenticated using(public.is_admin());
alter table public.manual_outbox drop constraint manual_outbox_media_check;
alter table public.manual_outbox add constraint manual_outbox_media_check check(media in ('texto','audio','video','imagem','arquivo'));
create function public.admin_send_attachment(p_id uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare a chat_attachments;l leads;
begin
 perform require_admin();
 perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
 perform pg_advisory_xact_lock(hashtextextended('mktech-secretario',0));
 select * into a from chat_attachments where id=p_id;
 if not found then raise exception 'Anexo não encontrado' using errcode='22023'; end if;
 select * into l from leads where id=a.lead_id for update;
 if not found or l.phone_e164 is null or l.do_not_contact then raise exception 'Contato indisponível' using errcode='22023'; end if;
 if l.secretary_handoff_at is null then perform admin_take_conversation(l.id); end if;
 insert into manual_outbox(id,lead_id,phone_e164,body,media,audio_path,audio_mime)
 values(a.id,a.lead_id,l.phone_e164,a.filename,case when a.mime like 'video/%' then 'video' when a.mime like 'image/%' then 'imagem' else 'arquivo' end,a.storage_path,a.mime)
 on conflict(id) do nothing;
 return a.id;
end $$;
revoke all on function public.admin_send_attachment(uuid) from public,anon,authenticated;
grant execute on function public.admin_send_attachment(uuid) to authenticated;

create or replace function public.api_manual_next(p_token uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare b manual_outbox;
begin
  if p_token is null then raise exception 'token inválido' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-manual',0));
  update manual_outbox set status='falhou',error='Sem confirmação do envio; confira no WhatsApp antes de reenviar'
    where status='enviando' and claimed_at<now()-interval '5 minutes';
  update manual_outbox m set status='falhou',error='Contato bloqueado ou telefone alterado'
    from leads l where m.lead_id=l.id and m.status='enfileirada' and (l.do_not_contact or l.phone_e164 is distinct from m.phone_e164);
  if exists(select 1 from manual_outbox where status='enviando') then return jsonb_build_object('status','aguardar'); end if;
  select * into b from manual_outbox where status='enfileirada' order by created_at,id limit 1 for update skip locked;
  if not found then return jsonb_build_object('status','nenhum'); end if;
  update manual_outbox set status='enviando',claimed_at=now() where id=b.id;
  return jsonb_build_object('status','enviar','id',b.id,'telefone',b.phone_e164,'texto',b.body,'media',b.media,'audio_path',b.audio_path,'audio_mime',b.audio_mime,'filename',b.body);
end $$;

create index if not exists whatsapp_history_lead_time_idx on public.whatsapp_history(lead_id,occurred_at desc);
create index if not exists outreach_replies_lead_time_idx on public.outreach_replies(lead_id,received_at desc);
create index if not exists outreach_outbound_lead_time_idx on public.outreach_outbound(lead_id,sent_at desc);
create index if not exists manual_outbox_lead_sent_idx on public.manual_outbox(lead_id,sent_at desc) where status='enviada';
