import {beforeEach,it,expect,describe} from 'vitest';
import {as,asAdmin,asService,candidate,createToken,pool,register,resetData,rpc,OUTSIDER_ID} from './helpers';
import {decide,type Context} from '@/lib/commercial/engine';
let token:string;
const phone='+5517991234567';
const svc=<T=any>(sql:string,p:unknown[]=[])=>asService(c=>rpc<T>(c,sql,p));
const next=()=>svc('select api_outreach_next($1)',[token]);
const pending=async()=> (await svc('select api_commercial_pending($1,10)',[token])).contexts[0];
const save=async()=>{const c=await pending();return svc('select api_commercial_save($1,$2,$3,$4,$5::jsonb)',[token,c.lead_id,c.revision,c.reply_id,JSON.stringify(decide(c as Context))]);};
const result=(id:string)=>svc("select api_commercial_result($1,$2,'enviada',$3,null)",[token,id,'provider-'+id]);
const reply=(text:string,id:string)=>svc('select api_outreach_reply($1,$2::jsonb)',[token,JSON.stringify({phone_e164:phone,body:text,kind:'humana',reason:'teste',opt_out:false,media:'texto',external_id:id})]);
async function setup(){
 const r=await register(token,candidate());
 await asAdmin(c=>c.query('select admin_commercial_lead($1,$2::jsonb)',[r.lead_id,JSON.stringify({eligible:true,eligibility_reason:'Teste autorizado'})]));
 await asAdmin(c=>c.query('select admin_outreach_settings($1::jsonb)',[JSON.stringify({enabled:true,window_start:0,window_end:24,reply_window_start:0,reply_window_end:24,send_days:[1,2,3,4,5,6,7],min_fit_score:0})]));
 await asAdmin(c=>c.query('select admin_commercial_settings($1::jsonb)',[JSON.stringify({enabled:true,channel_authorized:true,test_mode:true,test_phones:[phone],allowed_strategies:['A'],video_configured:true})]));
 await svc('select api_commercial_demo_health($1,$2::jsonb,true)',[token,JSON.stringify([{id:'DEMO_ROSANA_LANDING',available:true},{id:'DEMO_POLPUJA_VITRINE',available:true}])]);
 await save();await result((await next()).id);
 return r.lead_id;
}
describe('biblioteca integrada ao CRM e fila',()=>{
 beforeEach(async()=>{await resetData();token=(await createToken()).id;await pool.query("update commercial_demonstrations set available=false,verified_at=null");});
 it.each([['landing page','DEMO_ROSANA_LANDING','video'],['site vitrine','DEMO_POLPUJA_VITRINE','texto']])('oferta, autorização, envio e deduplicação de %s',async(term,demo,media)=>{
  const id=await setup();await reply('Quero ver um exemplo de '+term,'offer');await save();const offer=await next();expect(offer.media).toBe('texto');await result(offer.id);
  await reply('Pode enviar','consent');await save();const item=await next();expect(item.asset).toBe(demo);expect(item.media).toBe(media);
  expect((await pool.query('select sent_at from lead_demonstrations where lead_id=$1 and demonstration_id=$2',[id,demo])).rows[0].sent_at).toBeNull();
  await result(item.id);await result(item.id);expect((await pool.query("select count(*)::int n from commercial_outbox where lead_id=$1 and kind='demo'",[id])).rows[0].n).toBe(1);
  const recorded=(await pool.query('select * from lead_demonstrations where lead_id=$1 and demonstration_id=$2',[id,demo])).rows[0];expect(recorded.offered_at).toBeTruthy();expect(recorded.authorized_at).toBeTruthy();expect(recorded.sent_at).toBeTruthy();
  if(media==='texto')expect((await pool.query('select body from commercial_outbox where id=$1',[item.id])).rows[0].body).toContain('https://www.xn--polpuj-uta.com.br/');
  await reply('Pode enviar o exemplo de '+term,'repeat');await save();expect((await next()).asset).not.toBe(demo);
  expect((await pool.query('select client_response from lead_demonstrations where lead_id=$1 and demonstration_id=$2',[id,demo])).rows[0].client_response).toContain('exemplo');
 });
 it('não presume arquivo local disponível no servidor',async()=>{await setup();await reply('Quero um exemplo','request');await pool.query("update commercial_demonstrations set verified_at=now()-interval '4 minutes' where id='DEMO_ROSANA_LANDING'");expect((await pending()).demonstrations.find((d:any)=>d.id==='DEMO_ROSANA_LANDING').available).toBe(false);});
 it('material removido depois de autorizado não sai da fila',async()=>{await setup();await reply('Exemplo de landing page','offer');await save();await result((await next()).id);await reply('Pode enviar','consent');await save();await svc('select api_commercial_demo_health($1,$2::jsonb,false)',[token,'[]']);expect((await next()).status).toBe('fila_vazia');expect((await pool.query("select status from commercial_outbox where kind='demo'")).rows[0].status).toBe('cancelada');});
 it('catálogo e histórico só podem ser lidos por admin',async()=>{const id=await setup();await reply('Exemplo de landing page','offer');await save();expect(await as('authenticated',OUTSIDER_ID,c=>rpc(c,'select count(*)::int from commercial_demonstrations'))).toBe(0);expect(await as('authenticated',OUTSIDER_ID,c=>rpc(c,'select count(*)::int from lead_demonstrations'))).toBe(0);expect(await asAdmin(c=>rpc(c,'select count(*)::int from commercial_demonstrations'))).toBe(2);expect(await asAdmin(c=>rpc(c,'select count(*)::int from lead_demonstrations where lead_id=$1',[id]))).toBe(1);});
 it('visitante não altera disponibilidade nem lê biblioteca',async()=>{await expect(as('anon',null,c=>rpc(c,'select api_commercial_demo_health($1,$2::jsonb,true)',[token,'[]']))).rejects.toThrow();await expect(as('anon',null,c=>rpc(c,'select count(*) from commercial_demonstrations'))).rejects.toThrow();});
 it('não aceita autorização sem oferta confirmada no CRM',async()=>{await setup();await reply('Bom dia','forge');const c=await pending();const d=decide(c as Context);const forged={...d,action:'demonstration',demonstration_id:'DEMO_ROSANA_LANDING',body:'Exemplo',state:{...d.state,facts:{demo_authorized:'DEMO_ROSANA_LANDING'}}};expect((await svc('select api_commercial_save($1,$2,$3,$4,$5::jsonb)',[token,c.lead_id,c.revision,c.reply_id,JSON.stringify(forged)])).status).toBe('invalido');});
 it('resposta que chega antes da confirmação atrasada não se perde',async()=>{const id=await setup();await reply('Exemplo de landing page','offer');await save();await result((await next()).id);await reply('Pode enviar','consent');await save();const item=await next();await reply('Vi a demonstração','early-response');await result(item.id);const row=(await pool.query('select client_response,response_at from lead_demonstrations where lead_id=$1 and demonstration_id=$2',[id,'DEMO_ROSANA_LANDING'])).rows[0];expect(row.client_response).toBe('Vi a demonstração');expect(row.response_at).toBeTruthy();});
});
