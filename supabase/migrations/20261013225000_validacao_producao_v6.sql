-- Liberação de produção exige registro explícito de validação do teste encerrado.
alter table public.commercial_settings add column v6_validation_run uuid references public.commercial_test_runs(id);

create function public.admin_commercial_v6_validate(p_run uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t commercial_test_runs; missing text[]; intent text;
begin
 perform require_admin();
 perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
 select * into t from commercial_test_runs where id=p_run;
 if t.id is null or t.ended_at is null then raise exception 'Teste participativo precisa estar encerrado e revisado'; end if;
 if not exists(select 1 from leads where id=t.lead_id and phone_e164='+5517992250729') then raise exception 'Número de validação não autorizado'; end if;
 if (select count(distinct demonstration_id) from commercial_outbox where test_run_id=p_run and kind='demo' and status='entregue')<2
  or exists(select 1 from commercial_outbox where test_run_id=p_run and status in ('enviando','desconhecido')) then raise exception 'Demonstrações e transporte ainda não validados'; end if;
 if exists(select 1 from commercial_outbox where test_run_id=p_run and kind='demo' and status<>'cancelada' group by demonstration_id having count(*)>1) then raise exception 'Envio duplicado no teste'; end if;
 foreach intent in array array['HUMAN_GREETING','CHANNEL_CONFIRMED','DEMO_REQUEST','SEO_QUESTION','WAIT_REQUEST','OBJECTION','CONTRACT_REQUEST'] loop
  if not exists(select 1 from outreach_replies r, jsonb_array_elements(coalesce(r.semantic_interpretation->'intentions','[]')) i
    where r.lead_id=t.lead_id and r.received_at between t.started_at and t.ended_at and r.external_id is not null and i->>'kind'=intent) then missing:=array_append(missing,intent); end if;
 end loop;
 if missing is not null then raise exception 'Cenários participativos pendentes: %',array_to_string(missing,', '); end if;
 if not exists(select 1 from outreach_replies where lead_id=t.lead_id and received_at between t.started_at and t.ended_at and external_id is not null and semantic_interpretation->>'type'='automated') then raise exception 'Mensagem automática não validada'; end if;
 if not exists(select 1 from outreach_replies where lead_id=t.lead_id and received_at between t.started_at and t.ended_at and external_id is not null and kind='humana' and norm_text(body) like '%agendamento%') then raise exception 'Cenário de agendamento não validado'; end if;
 if not exists(select 1 from outreach_replies where lead_id=t.lead_id and received_at between t.started_at and t.ended_at and external_id is not null and opt_out) then raise exception 'Encerramento não validado'; end if;
 update commercial_settings set v6_validation_run=p_run where id=1;
 return jsonb_build_object('status','registrado','validation_run',p_run);
end $$;

alter function public.admin_commercial_settings(jsonb) rename to admin_commercial_settings_before_validation;
create function public.admin_commercial_settings(p jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare s commercial_settings; version text;
begin
 perform require_admin();
 perform pg_advisory_xact_lock(hashtextextended('mktech-envio',0));
 select * into s from commercial_settings where id=1 for update;
 version:=coalesce(p->>'engine_version',s.engine_version);
 if version not in ('v4','v6') then raise exception 'Versão inválida'; end if;
 if version='v6' and not coalesce((p->>'test_mode')::boolean,s.test_mode) and s.v6_validation_run is null then raise exception 'Produção V6 aguarda validação participativa completa'; end if;
 perform admin_commercial_settings_before_validation(p-'engine_version');
 update commercial_settings set engine_version=version where id=1;
end $$;
revoke execute on function public.admin_commercial_settings_before_validation(jsonb) from public,anon,authenticated,service_role;
revoke execute on function public.admin_commercial_v6_validate(uuid),public.admin_commercial_settings(jsonb) from public,anon,service_role;
grant execute on function public.admin_commercial_v6_validate(uuid),public.admin_commercial_settings(jsonb) to authenticated;
