// Checks authenticated pages and a synthetic direct upload. Never sends WhatsApp messages.
import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env.local');
const saved=JSON.parse(fs.readFileSync('backups/release-browser-session.json','utf8'));
const cookie=saved.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
const base=process.env.WORKSPACE_CHECK_URL||'https://mktech-prospeccao.vercel.app';
const headers={Cookie:cookie};
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
for(const [route,expected] of [
 ['/leads','Por nicho'],['/leads?aba=todos','leads encontrados'],
 ['/leads?aba=todos&categoria=instagram','Leads'],['/execucoes','observations'],
 ['/disparo','Destinatários e disparos'],['/disparo?aba=config','Intervalo mínimo'],
 ['/configuracoes','Credenciais da integração'],['/conversas','Não lidas'],
 ['/conversas?filtro=nao_lidas','Conversas'],['/api/conversas/versao','external_id'],
]){
 const start=performance.now();const r=await fetch(base+route,{headers});const body=await r.text();
 if(r.status!==200||r.url.includes('/login')||!body.includes(expected)||body.includes('Application error')||body.includes('Não foi possível carregar'))throw Error(`Page verification failed: ${route} HTTP ${r.status}`);
 console.log(JSON.stringify({route,status:r.status,ms:Math.round(performance.now()-start)}));
}
const post=body=>fetch(base+'/api/conversas/anexos',{method:'POST',headers:{...headers,Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
const lead=await db.from('leads').select('id').not('phone_e164','is',null).eq('do_not_contact',false).limit(1).single();
if(lead.error)throw Error('No valid lead for staging-only upload check');
let staged;
try{
 const bytes=5*1024*1024;
 const prepared=await post({action:'prepare',lead_id:lead.data.id,filename:'verificacao-tecnica.pdf',bytes:bytes+1});
 if(prepared.status!==201)throw Error(`Upload initialization failed: ${prepared.status}`);
 staged=await prepared.json();
 const content=Buffer.alloc(bytes);content.write('%PDF-1.4\n');
 const uploaded=await db.storage.from('chat-attachments').uploadToSignedUrl(staged.path,staged.token,content,{contentType:staged.mime});
 if(uploaded.error)throw Error('Direct upload failed');
 const rejected=await post({action:'send',id:staged.id});
 if(rejected.status!==422)throw Error('Incomplete upload was not rejected');
 const queued=await db.from('manual_outbox').select('id',{count:'exact',head:true}).eq('id',staged.id);
 if(queued.error||queued.count!==0)throw Error('Staging check unexpectedly queued a message');
 console.log(JSON.stringify({directUploadBytes:bytes,invalidSizeRejected:rejected.status,queuedMessages:0}));
}finally{
 if(staged){
  const removed=await db.storage.from('chat-attachments').remove([staged.path]);
  if(removed.error)throw Error('Failed cleaning synthetic upload');
  const deleted=await db.from('chat_attachments').delete().eq('id',staged.id);
  if(deleted.error)throw Error('Failed cleaning synthetic metadata');
 }
}
