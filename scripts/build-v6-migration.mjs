// Gera adaptações mínimas das funções V4 auditadas; não conecta a qualquer banco.
import { readFileSync, writeFileSync } from 'node:fs';
const original=readFileSync('supabase/migrations/20261013141307_hermes_v4.sql','utf8');
function definition(name){
 const start=original.indexOf(`create function public.${name}(`);
 if(start<0)throw new Error(name);
 const end=original.indexOf('end $$;',start)+7;
 return original.slice(start,end).replace('create function','create or replace function');
}
let pending=definition('api_commercial_pending').replace('public.api_commercial_pending(', 'public.api_commercial_pending_core(');
pending=pending.replace("order by (kind='humana') desc,received_at desc,id desc", "order by case when s.engine_version='v4' then (kind='humana')::integer else 0 end desc,received_at desc,id desc");
pending=pending.replace('where cl.eligible and not l.do_not_contact', "where cl.eligible and (s.engine_version='v4' or (coalesce(cl.retry_not_before,'-infinity')<=now() and (cl.lease_id is null or cl.lease_until<now()))) and not l.do_not_contact");
pending=pending.replace('r.id is distinct from cl.processed_reply', "(r.id is distinct from cl.processed_reply or (s.engine_version='v6' and exists(select 1 from outreach_replies pending_reply where pending_reply.lead_id=l.id and semantic_interpretation is null)))");
pending=pending.replace("not l.contacted and l.stage='novo'", "s.new_contacts_enabled and not l.contacted and l.stage='novo'");
pending=pending.replace("or (r.id is not null", "or (s.engine_version='v6' and cl.followup_at<=now() and nullif(cl.followup_reason,'') is not null) or (r.id is not null");
let save=definition('api_commercial_save').replace('public.api_commercial_save(', 'public.api_commercial_save_core(');
save=save.replace("order by (kind='humana') desc,received_at desc,id desc", "order by case when s.engine_version='v4' then (kind='humana')::integer else 0 end desc,received_at desc,id desc");
save=save.replace('kind,body,phone_e164)', 'kind,body,phone_e164,test_run_id)').replace("k,p->>'body',l.phone_e164)","k,p->>'body',l.phone_e164,c.active_test_run)");
save=save.replace('p_reply=c.processed_reply then', "p_reply=c.processed_reply and p->>'intent'<>'followup_v6' then");
save=save.replace("k:=case when p_reply is null", "k:=case when p->>'intent'='followup_v6' then 'followup' when p_reply is null");
let catalogSource=readFileSync('supabase/migrations/20261013152458_catalogo_demonstracoes.sql','utf8');
const catalogStart=catalogSource.indexOf('create function public.api_commercial_save(');
let catalog=catalogSource.slice(catalogStart,catalogSource.indexOf('end $$;',catalogStart)+7).replace('create function','create or replace function');
catalog=catalog.replace("and kind='demo' and status<>'cancelada'", "and kind='demo' and status<>'cancelada' and test_run_id is not distinct from (select active_test_run from commercial_leads where lead_id=p_lead)");
const head=readFileSync('scripts/v6-migration-head.sql','utf8');
const tail=readFileSync('scripts/v6-migration-tail.sql','utf8');
let sender=definition('api_outreach_next').replace('public.api_outreach_next(', 'public.api_outreach_next_core(');
sender=sender.replace("where cl.followup_at<=now()", "where s.engine_version='v4' and cl.followup_at<=now()");
writeFileSync('supabase/migrations/20261013210000_conversacao_v6.sql',head+'\n'+pending+'\n'+save+'\n'+catalog+'\n'+sender+'\n'+tail);
