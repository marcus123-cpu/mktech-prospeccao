// Sessão temporária do administrador existente, somente para verificar o painel publicado.
// generateLink não envia email; nunca imprimir links, cookies ou tokens.
import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
process.loadEnvFile('.env.local');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
if(url!=='https://xdhjlunvgtuxwjqsvqzj.supabase.co')throw new Error('Projeto inesperado');
const file='backups/release-browser-session.json';
if(process.argv.includes('--close')){
 const saved=JSON.parse(fs.readFileSync(file,'utf8'));
 const c=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
 await c.auth.setSession(saved.session);
 const {error}=await c.auth.signOut({scope:'local'});if(error)throw new Error('Falha encerrando sessão temporária');
 fs.unlinkSync(file);console.log('Sessão temporária encerrada.');
 if(fs.existsSync('backups/verify-ui-playwright.js'))fs.unlinkSync('backups/verify-ui-playwright.js');
}else{
 const db=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 const admins=await db.from('app_admins').select('user_id');
 if(admins.error||admins.data.length!==1)throw new Error('Administrador ambíguo');
 const id=admins.data[0].user_id;
 const user=await db.auth.admin.getUserById(id);if(user.error)throw new Error('Administrador indisponível');
 const link=await db.auth.admin.generateLink({type:'magiclink',email:user.data.user.email});
 if(link.error)throw new Error('Falha criando sessão de verificação');
 let cookies=[];
 const client=createServerClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[],setAll:value=>{cookies=value;}}});
 const verified=await client.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token});
 if(verified.error||verified.data.user?.id!==id)throw new Error('Falha autenticando sessão temporária');
 const permission=await client.rpc('is_admin');if(permission.error||permission.data!==true)throw new Error('Sessão sem acesso administrativo');
 const mapped=cookies.map(c=>({name:c.name,value:c.value,domain:'mktech-prospeccao.vercel.app',path:'/',secure:true,httpOnly:false,sameSite:'Lax'}));
 fs.writeFileSync(file,JSON.stringify({cookies:mapped,session:{access_token:verified.data.session.access_token,refresh_token:verified.data.session.refresh_token}}),{mode:0o600});
 const code=`async (page) => {const context=await page.context().browser().newContext();try{await context.addCookies(${JSON.stringify(mapped)});const p=await context.newPage();const checks=[];for(const route of ['/comercial','/conversas','/leads','/execucoes']){const response=await p.goto('https://mktech-prospeccao.vercel.app'+route);const body=await p.locator('body').innerText();checks.push({route,status:response.status(),authenticated:!p.url().includes('/login'),applicationError:body.includes('Não foi possível carregar')||body.includes('Application error'),catalog:route==='/comercial'?{rosana:body.includes('Landing page da Rosana'),polpuja:body.includes('Site da Polpujá')}:undefined});}return checks;}finally{await context.close();}}`;
 fs.writeFileSync('backups/verify-ui-playwright.js',code,{mode:0o600});
 console.log('Sessão temporária pronta para verificação autenticada.');
}
