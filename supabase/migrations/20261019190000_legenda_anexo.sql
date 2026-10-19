-- Legenda em vídeo, imagem e arquivo enviados pelo painel (aparece embaixo do arquivo no WhatsApp).
alter table public.chat_attachments add column if not exists caption text check (caption is null or length(caption) <= 1000);
alter table public.manual_outbox add column if not exists caption text check (caption is null or length(caption) <= 1000);

create or replace function public.admin_send_attachment(p_id uuid) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a chat_attachments; l leads;
begin
 perform require_admin();
 perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
 perform pg_advisory_xact_lock(hashtextextended('mktech-secretario',0));
 select * into a from chat_attachments where id = p_id;
 if not found then raise exception 'Anexo não encontrado' using errcode = '22023'; end if;
 select * into l from leads where id = a.lead_id for update;
 if not found or l.phone_e164 is null or l.do_not_contact then raise exception 'Contato indisponível' using errcode = '22023'; end if;
 if l.secretary_handoff_at is null then perform admin_take_conversation(l.id); end if;
 insert into manual_outbox(id, lead_id, phone_e164, body, caption, media, audio_path, audio_mime)
 values (a.id, a.lead_id, l.phone_e164, a.filename, nullif(btrim(a.caption), ''), case when a.mime like 'video/%' then 'video' when a.mime like 'image/%' then 'imagem' else 'arquivo' end, a.storage_path, a.mime)
 on conflict (id) do nothing;
 return a.id;
end $$;

create or replace function public.api_manual_next(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b manual_outbox;
begin
  if p_token is null then raise exception 'token inválido' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mktech-manual',0));
  update manual_outbox set status = 'falhou', error = 'Sem confirmação do envio; confira no WhatsApp antes de reenviar'
    where status = 'enviando' and claimed_at < now() - interval '5 minutes';
  update manual_outbox m set status = 'falhou', error = 'Contato bloqueado ou telefone alterado'
    from leads l where m.lead_id = l.id and m.status = 'enfileirada' and (l.do_not_contact or l.phone_e164 is distinct from m.phone_e164);
  if exists (select 1 from manual_outbox where status = 'enviando') then return jsonb_build_object('status', 'aguardar'); end if;
  select * into b from manual_outbox where status = 'enfileirada' order by created_at, id limit 1 for update skip locked;
  if not found then return jsonb_build_object('status', 'nenhum'); end if;
  update manual_outbox set status = 'enviando', claimed_at = now() where id = b.id;
  return jsonb_build_object('status', 'enviar', 'id', b.id, 'telefone', b.phone_e164, 'texto', b.body, 'media', b.media, 'audio_path', b.audio_path, 'audio_mime', b.audio_mime, 'filename', b.body, 'caption', b.caption);
end $$;

-- Na conversa, o balão do arquivo mostra também a legenda.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.conversation_timeline_for(uuid)'::regprocedure);
  d := replace(d, E'      x.body, x.media, case when x.media = ''audio''', E'      case when nullif(x.caption, '''') is not null then x.body || '' — '' || x.caption else x.body end, x.media, case when x.media = ''audio''');
  if d not like '%x.caption%' then raise exception 'conversation_timeline_for mudou: a troca não foi aplicada.'; end if;
  execute d;
end $$;
