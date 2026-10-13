import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc=vi.fn();
vi.mock("@/lib/supabase/admin",()=>({serviceClient:()=>({rpc})}));
const {POST:process}=await import("@/app/api/hermes/v1/comercial/processar/route");
const {POST:result}=await import("@/app/api/hermes/v1/envio/[id]/resultado/route");
const {POST:reply}=await import("@/app/api/hermes/v1/envio/respostas/route");
const {POST:health}=await import("@/app/api/hermes/v1/comercial/conexao/route");
const TOKEN="mkt_"+"e".repeat(64);
const ID="11111111-1111-4111-8111-111111111111";
const request=(body:unknown={},token:string|null=TOKEN)=>new Request("http://localhost/api/hermes/v1/comercial/processar",{method:"POST",headers:{"content-type":"application/json",...(token ? {authorization:`Bearer ${token}`} : {})},body:JSON.stringify(body)});
const ctx={lead_id:ID,revision:0,reply_id:null,business_name:"Clínica Teste",research:{},state:{stage:"PESQUISADO",role:"UNKNOWN",role_confidence:0,role_evidence:"",strategy:"A",video_offered:false,video_authorized:false,video_sent_at:null,facts:{},followup_at:null,followup_reason:null},messages:[],products:[],video_configured:false,manual:false,do_not_contact:false,first_contact:true,now:"2026-10-13T12:00:00Z"};
describe("API comercial V4",()=>{
  beforeEach(()=>{
    rpc.mockReset();rpc.mockImplementation(async(fn:string)=>{
      if(fn==="api_token_check")return {data:"tok",error:null};
      if(fn==="api_commercial_pending")return {data:{status:"ok",contexts:[ctx]},error:null};
      if(fn==="api_commercial_save")return {data:{status:"registrado"},error:null};
      if(fn==="api_commercial_result")return {data:{status:"registrado"},error:null};
      if(fn==="api_outreach_reply")return {data:{status:"registrada"},error:null};
      if(fn==="api_commercial_health")return {data:{status:"registrado"},error:null};
      if(fn==="api_commercial_demo_health")return {data:{status:"registrado"},error:null};
      return {data:null,error:{message:"unexpected"}};
    });
  });
  it("autentica preparação com escopo mensagens:escrever",async()=>{expect((await process(request())).status).toBe(200);expect(rpc).toHaveBeenCalledWith("api_token_check",expect.objectContaining({p_scope:"mensagens:escrever"}));});
  it("não processa sem token",async()=>{expect((await process(request({},null))).status).toBe(401);expect(rpc).not.toHaveBeenCalled();});
  it("ignora mensagem/preço recebidos no corpo e decide no servidor",async()=>{await process(request({body:"Oferta inventada R$ 1",price:1}));const p=rpc.mock.calls.find(c=>c[0]==="api_commercial_save")![1].p;expect(p.body).not.toContain("R$ 1");expect(p.intent).toBe("primeiro_contato");});
  it("falha de um contexto não impede processar o próximo",async()=>{rpc.mockImplementation(async(fn:string)=>{
    if(fn==="api_token_check")return {data:"tok"};if(fn==="api_commercial_pending")return {data:{status:"ok",contexts:[{...ctx,state:null},ctx]}};if(fn==="api_commercial_save")return {data:{status:"registrado"}};
  });const r=await(await process(request())).json();expect(r.results.map((x:{status:string})=>x.status)).toEqual(["contexto_invalido","registrado"]);});
  it("resultado V4 vai à RPC específica sem usar confirmação legada",async()=>{await result(request({etapa:"comercial",ok:true,message_status:"enviada",provider_id:"wa-id"}),{params:Promise.resolve({id:ID})});expect(rpc).toHaveBeenCalledWith("api_commercial_result",expect.objectContaining({p_provider:"wa-id",p_status:"enviada"}));expect(rpc.mock.calls.some(c=>c[0]==="api_outreach_result")).toBe(false);});
  it("falha ambígua fica desconhecida",async()=>{await result(request({etapa:"comercial",ok:false}),{params:Promise.resolve({id:ID})});expect(rpc).toHaveBeenCalledWith("api_commercial_result",expect.objectContaining({p_status:"desconhecido"}));});
  it("ID de entrada é preservado para deduplicação",async()=>{await reply(request({telefone:"+5517991234567",texto:"Sou a proprietária",tipo:"texto",message_id:"wa-input"}));expect(rpc).toHaveBeenCalledWith("api_outreach_reply",expect.objectContaining({p:expect.objectContaining({external_id:"wa-input"})}));});
  it("saúde da integração exige escopo de envio",async()=>{expect((await health(request({ready:false}))).status).toBe(200);expect(rpc).toHaveBeenCalledWith("api_token_check",expect.objectContaining({p_scope:"envio:operar"}));expect(rpc).toHaveBeenCalledWith("api_commercial_health",expect.objectContaining({p_ready:false}));});
  it("saúde da integração rejeita booleano ambíguo",async()=>{expect((await health(request({ready:"false"}))).status).toBe(422);expect(rpc.mock.calls.some(c=>c[0]==="api_commercial_health")).toBe(false);});
  it("disponibilidade do arquivo vem do serviço de envio autenticado",async()=>{expect((await health(request({ready:true,demonstrations:[{id:"DEMO_ROSANA_LANDING",available:true}]}))).status).toBe(200);expect(rpc).toHaveBeenCalledWith("api_commercial_demo_health",expect.objectContaining({p_ready:true,p_items:[{id:"DEMO_ROSANA_LANDING",available:true}]}));});
});
