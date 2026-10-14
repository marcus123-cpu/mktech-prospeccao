-- A recusa semântica encerra o lead e também marca a mensagem original para auditoria.
create function public.commercial_record_opt_out() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update outreach_replies set opt_out=true
    where id=new.reply_id and lead_id=new.lead_id and not opt_out;
  return new;
end $$;

create trigger commercial_record_opt_out_after_decision
after insert on public.commercial_decisions
for each row
when (new.action='stop' and new.reply_id is not null and (new.state->>'stage')='NAO_CONTATAR')
execute function public.commercial_record_opt_out();

update public.outreach_replies r set opt_out=true
where not r.opt_out and exists (
  select 1 from public.commercial_decisions d
  where d.reply_id=r.id and d.lead_id=r.lead_id
    and d.action='stop' and d.state->>'stage'='NAO_CONTATAR'
);

revoke all on function public.commercial_record_opt_out() from public,anon,authenticated,service_role;
