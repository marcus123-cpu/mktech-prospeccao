import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const root=path.resolve(process.env.HERMES_DEMO_ROOT || 'hermes/videos-demonstracao');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'catalogo.json'),'utf8'));
const ids=new Set();
for(const d of catalog.materials){
 if(!/^DEMO_[A-Z0-9_]+$/.test(d.id)||ids.has(d.id)||!d.name||!d.offer||d.offer.length>650||!d.caption||d.caption.length+(d.url?.length??0)+2>700||!Array.isArray(d.scopes)||!Array.isArray(d.match_terms))throw new Error('Metadados inválidos');
 ids.add(d.id);
 if(d.kind==='video'){
  const file=fs.realpathSync(path.resolve(root,d.path));const rel=path.relative(fs.realpathSync(root),file);
  if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Arquivo fora da biblioteca');
  const bytes=fs.readFileSync(file);
  if(bytes.length!==d.size_bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==d.sha256)throw new Error('Integridade inválida');
 }else if(d.kind==='link'){if(new URL(d.url).protocol!=='https:')throw new Error('URL inválida');}
 else throw new Error('Tipo inválido');
}
if(process.argv.includes('--seed-sql')){
 const sql=catalog.materials.map(d=>`insert into public.commercial_demonstrations(id,config,available,verified_at) values ('${d.id}','${JSON.stringify(d).replaceAll("'","''")}'::jsonb,${d.kind==='link'},${d.kind==='link' ? 'now()' : 'null'}) on conflict(id) do update set config=excluded.config;`).join('\n');
 fs.appendFileSync('supabase/migrations/20261013152458_catalogo_demonstracoes.sql','\n'+sql+'\n');
}else if(process.argv.includes('--apply')){
 if(fs.existsSync('.env.local'))process.loadEnvFile('.env.local');
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 // Não sobrescrever disponibilidade: só o serviço de envio confirma acesso ao vídeo.
 const {error}=await db.from('commercial_demonstrations').upsert(catalog.materials.map(d=>({id:d.id,config:d})),{onConflict:'id'});
 if(error)throw new Error('Falha ao sincronizar catálogo');
 console.log('Catálogo sincronizado:',[...ids].join(', '));
}else console.log('Catálogo e integridade verificados:',[...ids].join(', '));
