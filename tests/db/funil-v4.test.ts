import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { as, asAdmin, candidate, createToken, OUTSIDER_ID, pool, register, resetData } from "./helpers";
let token:string;
async function setup(status="enfileirada") {
  const result=await register(token,candidate());const id=result.lead_id;
  await pool.query("insert into commercial_outbox(lead_id,idempotency_key,kind,body,phone_e164,status,sent_at) values($1,$2,'initial','Olá, boa tarde! Tudo bem?','+5517991234567',$3,case when $3 in ('enviada','entregue') then now() else null end)",[id,randomUUID(),status]);
  return id;
}
async function card(id:string){return (await asAdmin(c=>c.query("select * from outreach_funnel where id=$1",[id]))).rows;}
describe("funil unificado",()=>{
  beforeEach(async()=>{await resetData();token=(await createToken()).id;});
  it.each([['enfileirada','fila'],['enviando','fila'],['enviada','enviado'],['entregue','enviado'],['desconhecido','atencao'],['falhou','atencao']])("V4 %s aparece em %s",async(status,column)=>{
    const id=await setup(status);const rows=await card(id);expect(rows).toHaveLength(1);expect(rows[0].coluna).toBe(column);
    if(status==='entregue')expect(rows[0].sent_at).toBeTruthy();
  });
  it("lead presente na fila antiga e no V4 aparece uma vez",async()=>{
    const id=await setup();await pool.query("insert into outreach_messages(lead_id,status,compliment,pain,improvement,body) values($1,'pronta','Evidência','Dor','Ideia','Mensagem antiga')",[id]);
    expect(await card(id)).toHaveLength(1);expect((await card(id))[0].message_status).toBe('enfileirada');
  });
  it("cancelamento do V4 mantém o cartão legado válido",async()=>{
    const id=await setup('cancelada');await pool.query("insert into outreach_messages(lead_id,status,compliment,pain,improvement,body) values($1,'pronta','Evidência','Dor','Ideia','Mensagem antiga')",[id]);
    expect(await card(id)).toHaveLength(1);expect((await card(id))[0].message_status).toBe('pronta');
  });
  it("apenas mensagem cancelada não aparece como fila",async()=>expect(await card(await setup('cancelada'))).toHaveLength(0));
  it("arquivar e devolver não apagam o registro V4",async()=>{
    const id=await setup();await asAdmin(c=>c.query('select admin_funnel_archive($1,true)',[id]));expect((await card(id))[0].coluna).toBe('arquivado');
    await asAdmin(c=>c.query('select admin_funnel_archive($1,false)',[id]));expect((await card(id))[0].coluna).toBe('fila');
  });
  it("recusa prevalece sobre envio pendente",async()=>{const id=await setup();await pool.query('update leads set do_not_contact=true where id=$1',[id]);expect((await card(id))[0].coluna).toBe('encerrado');});
  it("resposta humana prevalece sobre automática posterior",async()=>{
    const id=await setup('entregue');await pool.query("insert into outreach_replies(lead_id,phone_e164,body,kind,reason,received_at) values($1,'+5517991234567','Oi!','humana','teste',now()-interval '1 minute'),($1,'+5517991234567','Mensagem automática','automatica','teste',now())",[id]);
    expect((await card(id))[0]).toMatchObject({coluna:'conversa',last_reply:'Oi!',last_reply_kind:'humana'});
  });
  it("resposta automática sozinha aparece aguardando humano",async()=>{
    const id=await setup('entregue');await pool.query("insert into outreach_replies(lead_id,phone_e164,body,kind,reason,received_at) values($1,'+5517991234567','Mensagem automática','automatica','teste',now())",[id]);expect((await card(id))[0].coluna).toBe('aguardando');
  });
  it("outro usuário não lê dados de qualquer fila",async()=>{await setup();expect((await as('authenticated',OUTSIDER_ID,c=>c.query('select * from outreach_funnel'))).rowCount).toBe(0);});
  it("visitante não lê o funil",async()=>{await setup();await expect(as('anon',null,c=>c.query('select * from outreach_funnel'))).rejects.toThrow();});
});
