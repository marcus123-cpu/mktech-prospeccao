import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { decide, type Context } from "@/lib/commercial/engine";
import { as, asAdmin, asService, candidate, count, createToken, OUTSIDER_ID, pool, register, resetData, rpc } from "./helpers";
const PHONE="+5517991234567";
let token:string;
const svc=<T=any>(sql:string,p:unknown[]=[])=>asService(c=>rpc<T>(c,sql,p));
const next=()=>svc("select api_outreach_next($1)",[token]);
const pending=()=>svc("select api_commercial_pending($1,20)",[token]);
const result=(id:string,status="enviada",provider="provider-"+id)=>svc("select api_commercial_result($1,$2,$3,$4,$5)",[token,id,status,provider,null]);
const reply=(body:string,kind="humana",ext="in-1",opt=false)=>svc("select api_outreach_reply($1,$2::jsonb)",[token,JSON.stringify({phone_e164:PHONE,body,kind,reason:"teste",opt_out:opt,media:"texto",external_id:ext})]);
async function lead(extra:Record<string,unknown>={}) {
  const r=await register(token,candidate(extra));
  expect(r.lead_id,JSON.stringify(r)).toBeDefined();
  await asAdmin(c=>c.query("select admin_commercial_lead($1,$2::jsonb)",[r.lead_id,JSON.stringify({eligible:true,eligibility_reason:"Contato de teste autorizado"})]));
  return r.lead_id as string;
}
async function enable(p:Record<string,unknown>={}) {
  await asAdmin(c=>c.query("select admin_outreach_settings($1::jsonb)",[JSON.stringify({enabled:true,window_start:0,window_end:24,reply_window_start:0,reply_window_end:24,send_days:[1,2,3,4,5,6,7],min_fit_score:0})]));
  await asAdmin(c=>c.query("select admin_commercial_settings($1::jsonb)",[JSON.stringify({enabled:true,channel_authorized:true,test_mode:true,test_phones:[PHONE],allowed_strategies:["A"],video_configured:true,...p})]));
}
async function save(ctx:any) {
  // Mantém a suíte de regressão do fluxo V4 anterior; biblioteca tem suíte integrada própria.
  const d=decide({...ctx,demonstrations:undefined} as Context);
  return svc("select api_commercial_save($1,$2,$3,$4,$5::jsonb)",[token,ctx.lead_id,ctx.revision,ctx.reply_id,JSON.stringify(d)]);
}
async function queueInitial() { const id=await lead(); await enable(); const ctx=(await pending()).contexts[0]; const saved=await save(ctx); return {id,ctx,saved}; }
async function conversation(){const q=await queueInitial();const b=await next();expect(b.etapa).toBe("comercial");await result(b.id);return q.id;}

describe("persistência e autonomia V4",()=>{
  beforeEach(async()=>{await resetData();token=(await createToken()).id;});
  it("novo candidato ganha ficha V4 sem liberar envio",async()=>{const r=await register(token,candidate());const c=(await pool.query("select * from commercial_leads where lead_id=$1",[r.lead_id])).rows[0];expect(c.eligible).toBe(false);expect(c.stage).toBe("PESQUISADO");expect((await pending()).contexts).toHaveLength(0);});
  it("nome e endereço normalizados detectam duplicado sem apagar histórico",async()=>{await register(token,candidate({address:"Rua Brasil, 123",instagram:null}));const r=await register(token,candidate({address:"RUA BRASIL 123",phone:"(17) 99123-4568",instagram:null}));expect(r.status).toBe("existente");expect(await count("leads")).toBe(1);});
  it("endereço compartilhado com outro nome vai para revisão",async()=>{await register(token,candidate({address:"Rua Brasil, 123"}));const r=await register(token,candidate({address:"Rua Brasil, 123",business_name:"Estética Diamante",phone:"(17) 99123-4568",instagram:"@diamante"}));expect(r.status).toBe("possivel_duplicado");expect(await count("leads")).toBe(1);});
  it("duplicado atualiza evidência sem apagar negociação",async()=>{const id=await lead();await pool.query("update commercial_leads set stage='NEGOCIACAO' where lead_id=$1",[id]);await register(token,candidate({selection_reason:"Fonte verificada novamente"}));expect(await count("leads")).toBe(1);expect((await pool.query("select stage from commercial_leads where lead_id=$1",[id])).rows[0].stage).toBe("NEGOCIACAO");expect(await count("lead_evidences")).toBe(2);});
  it("primeiro contato é enfileirado sem aprovação individual",async()=>{const {saved}=await queueInitial();expect(saved.status).toBe("registrado");expect((await next()).status).toBe("enviar");});
  it("reserva é exclusiva entre enviadores concorrentes",async()=>{await queueInitial();const out=await Promise.all([next(),next()]);expect(out.filter(x=>x.status==="enviar")).toHaveLength(1);});
  it("gravar contexto antigo não duplica resposta",async()=>{const {ctx}=await queueInitial();expect((await save(ctx)).status).toBe("desatualizada");expect(await count("commercial_outbox")).toBe(1);});
  it("confirmar envio duas vezes não duplica contatos",async()=>{await queueInitial();const b=await next();await result(b.id);expect((await result(b.id)).status).toBe("existente");expect(await count("contact_events")).toBe(1);});
  it("enfileirar não significa entregue",async()=>{await queueInitial();expect(await count("commercial_outbox","status='entregue'")).toBe(0);});
  it("evento de entrega faz transição separada",async()=>{await queueInitial();const b=await next();await result(b.id);await result(b.id,"entregue");expect(await count("commercial_outbox","status='entregue'")).toBe(1);expect(await count("contact_events")).toBe(1);});
  it("recuperação após reinício não reenvia reserva ambígua",async()=>{await queueInitial();const b=await next();await pool.query("update commercial_outbox set claimed_at=now()-interval '6 minutes' where id=$1",[b.id]);expect((await next()).status).toBe("fila_vazia");expect(await count("commercial_outbox","status='desconhecido'")).toBe(1);expect((await pending()).contexts).toHaveLength(0);await result(b.id);expect(await count("commercial_outbox","status='enviada'")).toBe(1);});
  it("ID de entrada impede duplicação apesar de timestamp diferente",async()=>{await conversation();await reply("Sou a proprietária");expect((await reply("Sou a proprietária")).status).toBe("existente");expect(await count("outreach_replies")).toBe(1);});
  it("resposta automática não avança etapa nem agenda resposta",async()=>{const id=await conversation();await reply("Mensagem automática","automatica");await save((await pending()).contexts[0]);expect(await count("commercial_outbox")).toBe(1);expect((await pool.query("select stage from commercial_leads where lead_id=$1",[id])).rows[0].stage).toBe("CONTATO_ENVIADO");});
  it("decisor é registrado com evidência",async()=>{const id=await conversation();await reply("Sou a proprietária");await save((await pending()).contexts[0]);const c=(await pool.query("select * from commercial_leads where lead_id=$1",[id])).rows[0];expect(c.role).toBe("OWNER");expect(c.role_evidence).toContain("proprietária");expect(c.stage).toBe("CONTATO_COM_DECISOR");});
  it("nova entrada invalida resposta ainda na fila",async()=>{await conversation();await reply("Sou a proprietária");const old=(await pending()).contexts[0];await save(old);await reply("Quanto custa?","humana","in-2");expect(await count("commercial_outbox","status='cancelada'")).toBe(1);expect((await save(old)).status).toBe("desatualizada");});
  it("automática posterior mantém referência da pergunta humana",async()=>{await conversation();const human=await reply("Quanto custa?");await reply("Mensagem automática","automatica","in-auto");expect((await pending()).contexts[0].reply_id).toBe(human.reply_id);});
  it("devolver conversa retomada sem resposta permite continuar pergunta pendente",async()=>{const id=await conversation();await reply("Quero contratar");await save((await pending()).contexts[0]);expect((await pending()).contexts).toHaveLength(0);await asAdmin(c=>c.query("select admin_secretary_return($1)",[id]));expect((await pending()).contexts).toHaveLength(1);});
  it("vídeo autorizado só marca enviado após confirmação",async()=>{const id=await conversation();await reply("Sou a proprietária");await save((await pending()).contexts[0]);let b=await next();await result(b.id);await reply("Pode mandar","humana","in-2");await save((await pending()).contexts[0]);b=await next();expect(b.media).toBe("video");expect((await pool.query("select video_sent_at from commercial_leads where lead_id=$1",[id])).rows[0].video_sent_at).toBeNull();await result(b.id);expect((await pool.query("select stage from commercial_leads where lead_id=$1",[id])).rows[0].stage).toBe("VIDEO_ENVIADO");});
  it("sem autorização banco rejeita vídeo",async()=>{await conversation();await reply("Bom dia");const ctx=(await pending()).contexts[0];const d=decide(ctx);d.action="video";d.state.video_authorized=false;const r=await svc("select api_commercial_save($1,$2,$3,$4,$5::jsonb)",[token,ctx.lead_id,ctx.revision,ctx.reply_id,JSON.stringify(d)]);expect(r.status).toBe("invalido");});
  it("pedido de não contato cancela fila e acompanhamento",async()=>{const id=await conversation();await pool.query("update commercial_leads set followup_at=now()+interval '1 day',followup_reason='Pedido do contato' where lead_id=$1",[id]);await reply("Não tenho interesse","humana","in-1",true);expect((await pending()).contexts).toHaveLength(0);expect((await pool.query("select followup_at,stage from commercial_leads where lead_id=$1",[id])).rows[0]).toMatchObject({stage:"NAO_CONTATAR",followup_at:null});});
  it("Marcos assumir cancela mensagens não reservadas",async()=>{const {id}=await queueInitial();await asAdmin(c=>c.query("select admin_take_conversation($1)",[id]));expect(await count("commercial_outbox","status='cancelada'")).toBe(1);expect((await pending()).contexts).toHaveLength(0);});
  it("Marcos assumir durante envio pede aguardar confirmação",async()=>{const {id}=await queueInitial();await next();await expect(asAdmin(c=>c.query("select admin_take_conversation($1)",[id]))).rejects.toThrow(/mensagem saindo/);});
  it("mensagem no celular assume atendimento V4",async()=>{const id=await conversation();await svc("select api_outreach_outbound($1,$2::jsonb)",[token,JSON.stringify({phone_e164:PHONE,body:"Vou continuar daqui",media:"texto",external_id:"manual-1"})]);expect((await pool.query("select secretary_handoff_at from leads where id=$1",[id])).rows[0].secretary_handoff_at).not.toBeNull();});
  it("memória corrigida cancela decisão pendente e muda versão",async()=>{const {id,ctx}=await queueInitial();await asAdmin(c=>c.query("select admin_save_conversation_memory($1,$2::jsonb)",[id,JSON.stringify({facts:"Já temos site"})]));expect((await save(ctx)).status).toBe("desatualizada");expect(await count("commercial_outbox","status='cancelada'")).toBe(1);});
  it("contexto corrigido pode recriar primeiro contato ainda não enviado",async()=>{const {id}=await queueInitial();await asAdmin(c=>c.query("select admin_save_conversation_memory($1,$2::jsonb)",[id,JSON.stringify({facts:"Já temos site"})]));const ctx=(await pending()).contexts[0];expect(ctx.first_contact).toBe(true);await save(ctx);expect(await count("commercial_outbox","status='enfileirada'")).toBe(1);expect((await next()).status).toBe("enviar");});
  it("corrigir memória permite regenerar resposta cancelada ao mesmo cliente",async()=>{const id=await conversation();await reply("Sou a proprietária");await save((await pending()).contexts[0]);await asAdmin(c=>c.query("select admin_save_conversation_memory($1,$2::jsonb)",[id,JSON.stringify({facts:"Já temos site"})]));await save((await pending()).contexts[0]);expect(await count("commercial_outbox","status='enfileirada'")).toBe(1);expect(await count("commercial_outbox","status='cancelada'")).toBe(1);});
  it("lead em negociação nunca recebe nova primeira abordagem",async()=>{const id=await lead();await enable();await pool.query("update commercial_leads set stage='NEGOCIACAO' where lead_id=$1",[id]);expect((await pending()).contexts).toHaveLength(0);});
  it("pausa geral impede reserva",async()=>{await queueInitial();await pool.query("update outreach_settings set paused=true");expect((await next()).status).toBe("pausado");});
  it("ativação exige configuração e conexões recentes",async()=>{await enable();await pool.query("update commercial_settings set last_worker_at=null,last_sender_at=null");await expect(asAdmin(c=>c.query("select admin_commercial_activate()"))).rejects.toThrow(/conexão/);});
  it("desconexão cria notificação uma vez por mudança de estado",async()=>{await svc("select api_commercial_health($1,false)",[token]);await svc("select api_commercial_health($1,false)",[token]);expect(await count("commercial_notifications")).toBe(1);await svc("select api_commercial_health($1,true)",[token]);expect((await pool.query("select bridge_connected from commercial_settings")).rows[0].bridge_connected).toBe(true);});
  it("ativação controlada usa meta conservadora de um contato",async()=>{await enable();await pool.query("update commercial_settings set last_worker_at=now(),last_sender_at=now(),bridge_connected=true");await asAdmin(c=>c.query("select admin_commercial_activate()"));expect((await pool.query("select today_new_leads_target from outreach_settings")).rows[0].today_new_leads_target).toBe(1);});
  it("restrição de contatos de teste é aplicada no banco",async()=>{await lead();await enable({test_phones:["+5511999999999"]});expect((await pending()).contexts).toHaveLength(0);});
  it("horário de atendimento é respeitado",async()=>{await queueInitial();const h=new Date().getUTCHours();const local=(h+21)%24;await pool.query("update outreach_settings set reply_window_start=$1,reply_window_end=$2",[local===23 ? 0 : local+1,local===23 ? 1 : local+2]);expect((await next()).status).toBe("fora_do_horario");});
  it("meta zero impede novos contatos",async()=>{await queueInitial();await asAdmin(c=>c.query("select admin_outreach_today_target(0)"));expect((await next()).status).toBe("fila_vazia");});
  it("não gera lembrete só por silêncio",async()=>{await conversation();await pool.query("update commercial_outbox set sent_at=now()-interval '7 days'");expect((await next()).status).toBe("fila_vazia");expect(await count("commercial_outbox","kind='followup'")).toBe(0);});
  it("silêncio atualiza sem resposta sem gerar cobrança",async()=>{const id=await conversation();await pool.query("update commercial_outbox set sent_at=now()-interval '7 days'");await next();expect((await pool.query("select stage from commercial_leads where lead_id=$1",[id])).rows[0].stage).toBe("SEM_RESPOSTA");expect(await count("commercial_outbox","kind='followup'")).toBe(0);});
  it("retorno combinado é enfileirado uma vez",async()=>{const id=await conversation();await pool.query("update outreach_settings set next_send_at=null");await pool.query("update commercial_leads set followup_at=now()-interval '1 minute',followup_reason='Contato pediu retorno' where lead_id=$1",[id]);const b=await next();expect(b.status).toBe("enviar");await result(b.id);await next();expect(await count("commercial_outbox","kind='followup'")).toBe(1);});
  it("limite por conversa suspende apenas lead correspondente",async()=>{await conversation();await pool.query("update commercial_settings set max_messages=1");await reply("Sou a proprietária");await save((await pending()).contexts[0]);expect((await next()).status).toBe("fila_vazia");expect(await count("leads","secretary_handoff_at is not null")).toBe(1);});
  it("RLS nega dados comerciais a usuário de fora",async()=>{await lead();expect(await as("authenticated",OUTSIDER_ID,c=>rpc(c,"select count(*)::int from commercial_leads"))).toBe(0);await expect(as("authenticated",OUTSIDER_ID,c=>rpc(c,"select admin_commercial_metrics()"))).rejects.toThrow();});
  it("anon não executa RPC V4 privilegiada",async()=>{await expect(as("anon",null,c=>rpc(c,"select api_commercial_pending($1,1)",[token]))).rejects.toThrow();});
  it("dashboard calcula contagens reais sem confundir automáticas",async()=>{await conversation();await reply("Mensagem automática","automatica");const m=await asAdmin(c=>rpc<any>(c,"select admin_commercial_metrics()"));expect(m.metrics.contatados_hoje).toBe(1);expect(m.metrics.respostas_humanas).toBe(0);expect(m.experiments[0].respostas_humanas).toBe(0);});
  it("experimento aloca exatamente dez leads por estratégia sem exceder quota",async()=>{
    await pool.query("update prospecting_settings set daily_target=100");
    await enable({test_mode:false,allowed_strategies:["A","B","C"]});
    for(let i=0;i<31;i++)await lead({business_name:`Clínica ${randomUUID()}`,phone:`+55179${String(i).padStart(8,'0')}`,instagram:`@experimento${i}`});
    for(const ctx of (await pending()).contexts)await save(ctx);
    for(const ctx of (await pending()).contexts)await save(ctx);
    const rows=(await pool.query("select strategy,count(*)::int as n from commercial_leads where strategy is not null group by strategy order by strategy")).rows;
    expect(rows).toEqual([{strategy:"A",n:10},{strategy:"B",n:10},{strategy:"C",n:10}]);
    expect((await pending()).contexts).toHaveLength(0);
  });
  it("linha do tempo contém saída V4 confirmada",async()=>{const id=await conversation();const rows=(await asAdmin(c=>c.query("select * from conversation_timeline where lead_id=$1 and source='hermes_v4'",[id]))).rows;expect(rows).toHaveLength(1);});
  it("não confirma venda a partir de intenção",async()=>{const id=await conversation();await reply("Vamos fechar");await save((await pending()).contexts[0]);expect((await pool.query("select stage,closed_value from leads where id=$1",[id])).rows[0]).not.toMatchObject({stage:"fechado"});});
  it("proposta só entra no CRM depois de envio confirmado",async()=>{
    const id=await conversation();await asAdmin(c=>c.query("select admin_commercial_product($1::jsonb)",[JSON.stringify({name:"Landing page",scope:"landing_page_whatsapp",price:1500,conditions:"Condições oficiais",approved:true})]));
    await reply("Oferecemos limpeza de pele e quero somente WhatsApp. Me manda uma proposta");await save((await pending()).contexts[0]);expect(await count("proposals")).toBe(0);
    const b=await next();await result(b.id);await result(b.id);expect(await count("proposals")).toBe(1);expect((await pool.query("select stage from commercial_leads where lead_id=$1",[id])).rows[0].stage).toBe("PROPOSTA_ENVIADA");
  });
  it("tabela alterada cancela preço pendente e pede revisão localizada",async()=>{
    const id=await conversation();const p={name:"Landing page",scope:"landing_page_whatsapp",price:1500,conditions:"Condições oficiais",approved:true};
    const productId=await asAdmin(c=>rpc<string>(c,"select admin_commercial_product($1::jsonb)",[JSON.stringify(p)]));
    await reply("Quanto custa?");await save((await pending()).contexts[0]);await asAdmin(c=>c.query("select admin_commercial_product($1::jsonb)",[JSON.stringify({...p,id:productId,price:1700})]));
    expect(await count("commercial_outbox","status='cancelada'")).toBe(1);expect((await pool.query("select secretary_handoff_at from leads where id=$1",[id])).rows[0].secretary_handoff_at).not.toBeNull();
  });
});
