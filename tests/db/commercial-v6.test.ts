import { beforeEach, describe, expect, it } from 'vitest';
import { asAdmin, asService, candidate, createToken, enroll, pool, register, resetData, rpc } from './helpers';
import { greetingDecision } from '@/lib/commercial/v6/decision';
import { contextualDecision } from '@/lib/commercial/v6/decision';
let token:string;let lead:string;
const svc=(sql:string,args:unknown[]=[])=>asService(c=>rpc<any>(c,sql,args));
const contexts=()=>svc('select api_commercial_v6_contexts($1)',[token]);
const save=(ctx:any)=>svc('select api_commercial_v6_save($1,$2,$3::jsonb)',[token,ctx.lease_id,JSON.stringify(greetingDecision(ctx))]);
async function inbound(body:string,external_id='in-1',received_at=new Date(Date.now()-10000).toISOString()){
 return svc('select api_outreach_reply($1,$2::jsonb)',[token,JSON.stringify({phone_e164:'+5517991234567',body,kind:'humana',media:'texto',reason:'simulado',external_id,received_at})]);
}
async function sentLead(){
 await pool.query("insert into commercial_outbox(lead_id,idempotency_key,kind,body,phone_e164,status,sent_at) values($1,$2,'initial','Olá! Tudo bem?','+5517991234567','entregue',now()-interval '1 minute')",[lead,lead+':initial']);
 await pool.query('update leads set contacted=true where id=$1',[lead]);
}
describe('V6: leases e persistência isolada',()=>{
 beforeEach(async()=>{
  await resetData();token=(await createToken()).id;
  lead=(await register(token,candidate())).lead_id;
  await asAdmin(c=>c.query('select admin_commercial_lead($1,$2::jsonb)',[lead,JSON.stringify({eligible:true,eligibility_reason:'simulação isolada'})]));
  await enroll(lead);
  await pool.query("update commercial_settings set enabled=true,channel_authorized=true,engine_version='v6',test_phones=array['+5517991234567']; update outreach_settings set enabled=true,paused=false,window_start=0,window_end=24,reply_window_start=0,reply_window_end=24,min_fit_score=0,send_days=array[1,2,3,4,5,6,7]");
 });
 it('reserva exclusiva entre workers',async()=>{const r=await Promise.all([contexts(),contexts()]);expect(r.reduce((n,x)=>n+x.contexts.length,0)).toBe(1);});
 it('snapshot pertence ao token que reservou',async()=>{const ctx=(await contexts()).contexts[0];const other=(await createToken()).id;expect(await svc('select api_commercial_v6_snapshot($1,$2)',[other,ctx.lease_id])).toBeNull();});
 it('snapshot expira sem perder memória',async()=>{const ctx=(await contexts()).contexts[0];await pool.query("update commercial_leads set lease_until=now()-interval '1 minute'");expect(await svc('select api_commercial_v6_snapshot($1,$2)',[token,ctx.lease_id])).toBeNull();expect((await contexts()).contexts).toHaveLength(1);});
 it('diagnóstico incompleto persiste prontidão sem enviar',async()=>{const ctx=(await contexts()).contexts[0];const r=await save(ctx);expect(r.status).toBe('registrado');expect((await pool.query('select count(*) from commercial_outbox')).rows[0].count).toBe('0');expect((await pool.query('select readiness from commercial_leads where lead_id=$1',[lead])).rows[0].readiness.status).toBe('NEEDS_RESEARCH');});
 it('decisão reapresentada não duplica',async()=>{const ctx=(await contexts()).contexts[0];await save(ctx);expect((await save(ctx)).status).toBe('desatualizada');});
 it('falha de IA não gera mensagem e aplica espera',async()=>{const ctx=(await contexts()).contexts[0];await svc('select api_commercial_v6_failure($1,$2,$3)',[token,ctx.lease_id,'inference_timeout']);expect((await contexts()).contexts).toHaveLength(0);expect((await pool.query('select inference_failures from commercial_leads')).rows[0].inference_failures).toBe(1);});
 it('pausa global invalida autorização final',async()=>{const ctx=(await contexts()).contexts[0];await pool.query('update outreach_settings set paused=true');expect((await save(ctx)).status).toBe('desligado');});
 it('mudança de revisão invalida decisão',async()=>{const ctx=(await contexts()).contexts[0];await pool.query('update commercial_leads set revision=revision+1');expect((await save(ctx)).status).toBe('desatualizada');});
 it('pausar novos contatos não desliga secretário',async()=>{await pool.query('update commercial_settings set new_contacts_enabled=false');expect((await contexts()).contexts).toHaveLength(0);expect((await pool.query('select enabled from commercial_settings')).rows[0].enabled).toBe(true);});
 it('modo teste exclui qualquer outro telefone',async()=>{await pool.query("update commercial_settings set test_phones=array['+5517992250729']");expect((await contexts()).contexts).toHaveLength(0);});
 it('V4 continua selecionável',async()=>{await pool.query("update commercial_settings set engine_version='v4'");expect((await contexts()).status).toBe('v4');});
 it('produção V6 fica bloqueada enquanto teste participativo estiver incompleto',async()=>{await expect(asAdmin(c=>c.query('select admin_commercial_settings($1::jsonb)',[JSON.stringify({test_mode:false})]))).rejects.toThrow(/validação participativa/);expect((await pool.query('select test_mode from commercial_settings')).rows[0].test_mode).toBe(true);});
 it('registro de validação exige teste encerrado e evidências',async()=>{await expect(asAdmin(c=>c.query('select admin_commercial_v6_validate($1)',['00000000-0000-4000-8000-000000000001']))).rejects.toThrow(/encerrado/);});
 it('entrada humana é provisória até interpretação',async()=>{await sentLead();await inbound('Bom dia');expect((await pool.query('select kind,semantic_interpretation from outreach_replies')).rows[0]).toMatchObject({kind:'automatica',semantic_interpretation:null});});
 it('automação posterior é o contexto mais recente',async()=>{await sentLead();await inbound('Bom dia','human');const auto=await inbound('Agenda automática','auto',new Date(Date.now()-5000).toISOString());const ctx=(await contexts()).contexts[0];expect(ctx.reply_id).toBe(auto.reply_id);expect(ctx.pending_messages).toHaveLength(2);});
 it('nova entrada invalida lease em preparação',async()=>{await sentLead();await inbound('Bom dia');const ctx=(await contexts()).contexts[0];await inbound('Já temos site','in-2');expect((await save(ctx)).status).toBe('desatualizada');});
 it('entrada repetida não invalida lease',async()=>{await sentLead();await inbound('Bom dia');const ctx=(await contexts()).contexts[0];expect((await inbound('Bom dia')).status).toBe('existente');expect(await svc('select api_commercial_v6_snapshot($1,$2)',[token,ctx.lease_id])).toBeTruthy();});
 it('aguardar automação persiste intenção e memória',async()=>{
  await sentLead();await inbound('Agenda online, retornaremos em breve');const ctx=(await contexts()).contexts[0];const p:any={interpretations:[{message_id:ctx.reply_id,type:'automated',confidence:.99,intentions:[{kind:'AUTOMATED_GREETING',confidence:.99,evidence:'retornaremos em breve'}]}],action:'wait',response:null,reason:'aguardar humano',phase:'WAITING_HUMAN',role:'AUTOMATED_ATTENDANT',role_evidence:'retornaremos em breve',solution:null,opportunity_index:null,demonstration_id:null,product_id:null,confirmed_facts:[{key:'agenda',value:'Agenda online informada',source_id:ctx.reply_id,evidence:'Agenda online'}],uncertain_facts:[],answered_questions:[],objections:[],summary:'Automação informa agenda online',next_action:'Aguardar humano',followup_at:null,followup_evidence:'',source_ids:[ctx.reply_id]};
  const d=contextualDecision(ctx,p,'mock-test');expect(d.validation_errors).toEqual([]);
  const r=await svc('select api_commercial_v6_save($1,$2,$3::jsonb)',[token,ctx.lease_id,JSON.stringify(d)]);expect(r.status).toBe('registrado');
  expect((await pool.query('select commercial_memory,conversation_phase from commercial_leads')).rows[0]).toMatchObject({conversation_phase:'WAITING_HUMAN',commercial_memory:{summary:p.summary}});
  expect((await contexts()).contexts).toHaveLength(0);
  expect((await pool.query('select count(*) from commercial_outbox')).rows[0].count).toBe('1');
 });
 it('sessão real exige número autorizado e modo teste',async()=>{await expect(asAdmin(c=>c.query('select admin_commercial_v6_test_begin($1::jsonb)',[JSON.stringify({simulation:true})]))).rejects.toThrow(/número autorizado/);});
 it('memória automática mantém fila; edição humana cancela',async()=>{
  await sentLead();await inbound('Quem é?');const ctx=(await contexts()).contexts[0];
  const p:any={interpretations:[{message_id:ctx.reply_id,type:'human',confidence:.99,intentions:[{kind:'BUSINESS_QUESTION',confidence:.99,evidence:'Quem é?'}]}],action:'respond',response:'Sou o assistente comercial da MKTech Dev, empresa de sites e sistemas.',reason:'Responder quem somos',phase:'WAITING_CHANNEL_CONFIRMATION',role:'UNKNOWN',role_evidence:'',solution:null,opportunity_index:null,demonstration_id:null,product_id:null,confirmed_facts:[],uncertain_facts:[],answered_questions:[],objections:[],summary:'Cliente perguntou quem somos',next_action:'Confirmar canal comercial',followup_at:null,followup_evidence:'',source_ids:[]};
  const d=contextualDecision(ctx,p,'mock-test');expect(d.validation_errors).toEqual([]);
  const r=await svc('select api_commercial_v6_save($1,$2,$3::jsonb)',[token,ctx.lease_id,JSON.stringify(d)]);expect(r.status).toBe('registrado');
  expect((await pool.query('select status from commercial_outbox where id=$1',[r.id])).rows[0].status).toBe('enfileirada');
  expect((await pool.query('select processed_reply from commercial_leads')).rows[0].processed_reply).toBe(ctx.reply_id);
  await asAdmin(c=>c.query('select admin_save_conversation_memory($1,$2::jsonb)',[lead,JSON.stringify({facts:'Correção factual do administrador'})]));
  expect((await pool.query('select status from commercial_outbox where id=$1',[r.id])).rows[0].status).toBe('cancelada');
 });
 it('encaminhamento avisa uma vez e assume após confirmação do transporte',async()=>{
  await sentLead();await pool.query("update commercial_leads set commercial_memory=jsonb_set(commercial_memory,'{introduced}','true')");await inbound('Quanto custa?');const ctx=(await contexts()).contexts[0];
  const p:any={interpretations:[{message_id:ctx.reply_id,type:'human',confidence:.99,intentions:[{kind:'PRICE_QUESTION',confidence:.99,evidence:'Quanto custa?'}]}],action:'handoff',response:'Vou encaminhar seu pedido à equipe responsável para confirmar o orçamento.',reason:'Não há produto e preço aprovados',phase:'HUMAN_HANDOFF',role:'UNKNOWN',role_evidence:'',solution:null,opportunity_index:null,demonstration_id:null,product_id:null,confirmed_facts:[],uncertain_facts:[],answered_questions:[],objections:[],summary:'Cliente pediu preço; equipe deve confirmar orçamento',next_action:'Aguardar equipe responsável',followup_at:null,followup_evidence:'',source_ids:[]};
  const d=contextualDecision(ctx,p,'mock-test');expect(d.validation_errors).toEqual([]);
  const saved=await svc('select api_commercial_v6_save($1,$2,$3::jsonb)',[token,ctx.lease_id,JSON.stringify(d)]);expect(saved.status).toBe('registrado');
  expect((await pool.query('select secretary_handoff_at from leads where id=$1',[lead])).rows[0].secretary_handoff_at).toBeNull();
  const n=await svc('select api_outreach_next($1)',[token]);expect(n.id).toBe(saved.id);
  await svc('select api_commercial_result($1,$2,$3,$4,$5)',[token,n.id,'enviada','mock-handoff-ack',null]);
  expect((await pool.query('select secretary_handoff_at from leads where id=$1',[lead])).rows[0].secretary_handoff_at).toBeTruthy();
  expect((await contexts()).contexts).toHaveLength(0);
 });
 it('sessão real preserva histórico anterior e enfileira só saudação',async()=>{
  await pool.query("update leads set phone_raw='+5517992250729' where id=$1",[lead]);
  await pool.query("update commercial_settings set test_phones=array['+5517992250729']");
  const r=await asAdmin(c=>rpc<any>(c,'select admin_commercial_v6_test_begin($1::jsonb)',[JSON.stringify({simulation:true,services:['limpeza de pele']})]));
  expect(r.test_run_id).toBeTruthy();
  const box=(await pool.query('select * from commercial_outbox')).rows[0];expect(box.test_run_id).toBe(r.test_run_id);expect(box.kind).toBe('reply');
  const n=await svc('select api_outreach_next($1)',[token]);expect(n.status).toBe('enviar');expect(n.texto).toMatch(/^Olá, (bom dia|boa tarde|boa noite)! Tudo bem\?$/);
  await svc('select api_commercial_result($1,$2,$3,$4,$5)',[token,n.id,'enviada','test-wa-id',null]);
  expect((await pool.query('select conversation_phase from commercial_leads')).rows[0].conversation_phase).toBe('WAITING_FIRST_REPLY');
  await asAdmin(c=>c.query('select admin_commercial_v6_test_end($1)',[r.test_run_id]));
  expect((await pool.query('select active_test_run from commercial_leads')).rows[0].active_test_run).toBeNull();
  expect((await pool.query('select final_snapshot,ended_at from commercial_test_runs')).rows[0].ended_at).toBeTruthy();
  expect((await pool.query('select count(*) from commercial_outbox')).rows[0].count).toBe('1');
 });
 it('21 entradas são classificadas em lotes sem perder a mais recente',async()=>{
  await sentLead();for(let i=0;i<21;i++)await inbound('Pergunta '+i,'batch-'+i,new Date(Date.now()-60000+i*1000).toISOString());
  const first=(await contexts()).contexts[0];expect(first.pending_messages).toHaveLength(20);
  function proposed(ctx:any,action:string){return {interpretations:ctx.pending_messages.map((m:any)=>({message_id:m.id,type:'human',confidence:.99,intentions:[{kind:'BUSINESS_QUESTION',confidence:.99,evidence:m.body}]})),action,response:action==='respond'?'Sou o assistente comercial da MKTech Dev. Posso orientar sobre sites e sistemas.':null,reason:'Processar lote ordenado',phase:'WAITING_CHANNEL_CONFIRMATION',role:'UNKNOWN',role_evidence:'',solution:null,opportunity_index:null,demonstration_id:null,product_id:null,confirmed_facts:[],uncertain_facts:[],answered_questions:[],objections:[],summary:'Lote de mensagens recebido',next_action:'Responder à mensagem mais recente',followup_at:null,followup_evidence:'',source_ids:[]};}
  let d=contextualDecision(first,proposed(first,'wait') as any,'mock-test');expect(d.validation_errors).toEqual([]);
  expect((await svc('select api_commercial_v6_save($1,$2,$3::jsonb)',[token,first.lease_id,JSON.stringify(d)])).status).toBe('registrado');
  const second=(await contexts()).contexts[0];expect(second.pending_messages).toHaveLength(1);expect(second.pending_messages[0].body).toBe('Pergunta 20');
  d=contextualDecision(second,proposed(second,'respond') as any,'mock-test');expect(d.validation_errors).toEqual([]);
  expect((await svc('select api_commercial_v6_save($1,$2,$3::jsonb)',[token,second.lease_id,JSON.stringify(d)])).status).toBe('registrado');
  expect((await pool.query('select count(*) from outreach_replies where semantic_interpretation is not null')).rows[0].count).toBe('21');
  expect((await pool.query("select count(*) from commercial_outbox where kind='reply'")).rows[0].count).toBe('1');
 });
});
