import {readFileSync,writeFileSync} from 'node:fs';
const base=readFileSync('supabase/migrations/20261013210000_conversacao_v6.sql','utf8');
const tail=readFileSync('scripts/v6-migration-tail.sql','utf8');
function get(source,name){const start=source.indexOf(`function public.${name}(`);if(start<0)throw new Error(name);return 'create or replace '+source.slice(start,source.indexOf('end $$;',start)+7);}
let pending=get(base,'api_commercial_pending_core');
const target='pending_reply.lead_id=l.id and semantic_interpretation is null';
if(!pending.includes(target))throw new Error('Condição original não encontrada');
pending=pending.replace(target,target+" and (cl.active_test_run is null or pending_reply.received_at>=(select started_at from commercial_test_runs where id=cl.active_test_run))");
let save=get(base,'api_commercial_save_core');
save=save.replace("p_reply=c.processed_reply and p->>'intent'<>'followup_v6'", "p_reply=c.processed_reply and p->>'intent'<>'followup_v6' and (s.engine_version='v4' or jsonb_array_length(coalesce(p->'interpretations','[]'))=0)");
writeFileSync('supabase/migrations/20261013224000_pendencias_semanticas_v6.sql','-- Classificação pendente, sessão e reserva de correção sem repetir respostas.\n'+pending+'\n'+save+'\n'+get(tail,'api_commercial_v6_contexts'));
