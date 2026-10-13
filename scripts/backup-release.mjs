import fs from 'node:fs';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env.local');
if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='xdhjlunvgtuxwjqsvqzj.supabase.co')throw new Error('Projeto diferente do destino autorizado');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const version=process.argv.includes('--v6')?'v6':'v4';
const root=path.resolve('backups','hermes-'+version+'-'+new Date().toISOString().replaceAll(':','-'));
fs.mkdirSync(root,{recursive:true});
const tables=['app_admins','contact_events','dedupe_events','duplicate_reviews','hermes_requests','hermes_runs','idempotency_keys','integration_tokens','lead_conversation_memory','lead_diagnoses','lead_evidences','lead_message_uses','lead_messages','lead_notes','leads','outreach_followups','outreach_messages','outreach_outbound','outreach_replies','outreach_secretary','outreach_settings','proposals','prospecting_settings','stage_events'];
const counts={};
if(version==='v6')tables.push('commercial_settings','commercial_leads','commercial_decisions','commercial_outbox','commercial_events','commercial_notifications','commercial_products','commercial_demonstrations','lead_demonstrations');
for(const table of tables){
 const rows=[];
 for(let offset=0;;offset+=500){const {data,error}=await db.from(table).select('*').range(offset,offset+499);if(error)throw new Error('Backup falhou: '+table);rows.push(...data);if(data.length<500)break;}
 fs.writeFileSync(path.join(root,table+'.json'),JSON.stringify(rows),{flag:'wx'});counts[table]=rows.length;
}
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({project:'xdhjlunvgtuxwjqsvqzj',created_at:new Date().toISOString(),counts},null,2));
console.log(JSON.stringify({backup:root,counts}));
