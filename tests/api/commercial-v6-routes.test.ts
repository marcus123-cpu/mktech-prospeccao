import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc=vi.fn();
vi.mock('@/lib/supabase/admin',()=>({serviceClient:()=>({rpc})}));
const {POST:contexts}=await import('@/app/api/hermes/v1/comercial/contextos/route');
const {POST:decide}=await import('@/app/api/hermes/v1/comercial/decidir/route');
const id='00000000-0000-4000-8000-000000000001';
const token='mkt_'+'c'.repeat(64);
const request=(body:unknown={},auth=true)=>new Request('https://localhost/api/hermes/v1/comercial/decidir',{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
const ctx={lead_id:id,revision:0,reply_id:null,lease_id:id,business_name:'Simulação',city:'Bauru',recipient_timezone:'America/Sao_Paulo',phase:'NEEDS_RESEARCH',first_contact:true,now:'2026-10-13T15:00:00Z',manual:false,do_not_contact:false,research:{},products:[],messages:[],pending_messages:[],state:{stage:'PESQUISADO',role:'UNKNOWN',role_confidence:0,role_evidence:'',strategy:'A',facts:{},video_offered:false,video_authorized:false,video_sent_at:null,followup_at:null,followup_reason:null},commercial_memory:{summary:'',confirmed_facts:[],uncertain_facts:[],answered_questions:[],objections:[],next_action:'',solution:null,introduced:false,channel_confirmed:false,wait_acknowledged:[]}};
describe('V6: fronteira de autorização HTTP',()=>{
 beforeEach(()=>{rpc.mockReset();rpc.mockImplementation(async(name:string)=>{
  if(name==='api_token_check')return {data:id,error:null};
  if(name==='api_commercial_v6_contexts')return {data:{status:'ok',contexts:[]},error:null};
  if(name==='api_commercial_v6_snapshot')return {data:ctx,error:null};
  if(name==='api_commercial_v6_save')return {data:{status:'registrado'},error:null};
  if(name==='api_commercial_v6_failure')return {data:{status:'aguardar'},error:null};
  return {data:null,error:{message:'unexpected'}};
 });});
 it('não revela contexto sem autenticação',async()=>{expect((await contexts(request({},false))).status).toBe(401);expect(rpc).not.toHaveBeenCalled();});
 it('contexto exige escopo comercial',async()=>{expect((await contexts(request())).status).toBe(200);expect(rpc).toHaveBeenCalledWith('api_token_check',expect.objectContaining({p_scope:'mensagens:escrever'}));});
 it('cliente não substitui snapshot, diagnóstico ou estado',async()=>{expect((await decide(request({lease_id:id,context:ctx}))).status).toBe(422);expect(rpc.mock.calls.some(call=>call[0]==='api_commercial_v6_save')).toBe(false);});
 it('sem diagnóstico servidor registra espera e nenhum texto',async()=>{await decide(request({lease_id:id}));const saved=rpc.mock.calls.find(call=>call[0]==='api_commercial_v6_save')![1].p;expect(saved.action).toBe('wait');expect(saved.body).toBeNull();expect(saved.readiness.status).toBe('NEEDS_RESEARCH');});
 it('falha do modelo não chama motor V4 ou transporte',async()=>{await decide(request({lease_id:id,failure:'inference_timeout'}));expect(rpc).toHaveBeenCalledWith('api_commercial_v6_failure',expect.objectContaining({p_reason:'inference_timeout'}));expect(rpc.mock.calls.some(call=>call[0]==='api_commercial_save')).toBe(false);});
 it('não aceita mensagem arbitrária',async()=>{expect((await decide(request({lease_id:id,body:'texto enviado pelo worker'}))).status).toBe(422);});
 it('modelo e proposta são obrigatórios depois da saudação',async()=>{rpc.mockImplementation(async(name:string)=>({data:name==='api_token_check'?id:name==='api_commercial_v6_snapshot'?{...ctx,first_contact:false}:null,error:null}));expect((await decide(request({lease_id:id}))).status).toBe(422);});
 it('lease inexistente não autoriza envio',async()=>{rpc.mockImplementation(async(name:string)=>({data:name==='api_token_check'?id:null,error:null}));expect((await decide(request({lease_id:id}))).status).toBe(409);});
 it('proposta inválida aplica espera e registra motivo sem enfileirar',async()=>{
  const c={...ctx,first_contact:false,reply_id:id,phase:'WAITING_FIRST_REPLY',pending_messages:[{id,body:'Oi',media:'texto',kind:'pendente_semantica',received_at:ctx.now}]};
  rpc.mockImplementation(async(name:string)=>({data:name==='api_token_check'?id:name==='api_commercial_v6_snapshot'?c:name==='api_commercial_v6_failure'?{status:'aguardar'}:null,error:null}));
  const proposal={interpretations:[{message_id:id,type:'human',confidence:.95,intentions:[{kind:'HUMAN_GREETING',confidence:.95,evidence:'Oi'}]}],action:'respond',response:'Me chamo Marcos',reason:'teste',phase:'WAITING_CHANNEL_CONFIRMATION',role:'UNKNOWN',role_evidence:'',solution:null,opportunity_index:null,demonstration_id:null,product_id:null,confirmed_facts:[],uncertain_facts:[],answered_questions:[],objections:[],summary:'teste',next_action:'aguardar',followup_at:null,followup_evidence:'',source_ids:[]};
  const res=await(await decide(request({lease_id:id,proposal,model:'test'}))).json();expect(res.status).toBe('validacao_recusada');expect(res.errors).toContain('Identidade deve ser de assistente comercial');expect(rpc.mock.calls.some(call=>call[0]==='api_commercial_v6_save')).toBe(false);
 });
});
