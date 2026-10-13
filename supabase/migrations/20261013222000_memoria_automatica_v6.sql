-- A projeção da memória já validada não é uma correção humana do contexto.
-- Edição manual mantém o cancelamento e a mudança de revisão anteriores.
create or replace function public.commercial_memory_changed() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.updated_by is null and exists(
  select 1 from commercial_leads c cross join commercial_settings s
  where c.lead_id=new.lead_id and s.id=1 and s.engine_version='v6'
   and new.summary=coalesce(c.commercial_memory->>'summary','')
   and new.facts=left((c.commercial_memory->'confirmed_facts')::text,3000)
   and new.objections=left((c.commercial_memory->'objections')::text,2000)
   and new.next_action=coalesce(c.commercial_memory->>'next_action','')
 ) then return null; end if;
 update commercial_leads set revision=revision+1,
  processed_reply=case when exists(select 1 from commercial_outbox where lead_id=new.lead_id and status='enfileirada') then null else processed_reply end
  where lead_id=new.lead_id;
 update commercial_outbox set status='cancelada',error='Memória alterada; reler contexto' where lead_id=new.lead_id and status='enfileirada';
 return null;
end $$;
