import { beforeEach, describe, expect, it } from "vitest";
import { as, asAdmin, asService, candidate, count, createToken, OUTSIDER_ID, pool, register, resetData, rpc, tokenId } from "./helpers";

const diagnosis = {
  fit_score: 72,
  confidence: "media",
  summary: "Estética facial ativa no Instagram.",
  pains: [{ pain: "Agendamento só por telefone", evidence: "Post de 03/10/2026 pede para agendar pelo telefone" }],
  offer: "site_com_agendamento",
  offer_reason: "Agendamento manual.",
};

const lote = (sufixo = "") => ({
  alerta: null,
  variantes: [
    { estilo: "direta", mensagem: `Oi, Adriele! Vi o post de 03/10 sobre agendar por telefone${sufixo}. Posso te mostrar uma ideia?`, dor_usada: "Agendamento por telefone", evidencia_usada: "Post de 03/10/2026", risco: "baixo" },
    { estilo: "pulga", mensagem: `Adriele, quem vê seus posts pelo celular consegue marcar fora do horário${sufixo}?`, dor_usada: "Agendamento por telefone", evidencia_usada: "Post de 03/10/2026", risco: "baixo" },
    { estilo: "consultiva", mensagem: `Oi, Adriele. Como funciona hoje a marcação dos seus horários${sufixo}?`, dor_usada: "Agendamento", evidencia_usada: null, risco: "baixo" },
  ],
});

async function save(tok: string, lead: string, p: object) {
  return asService((c) => rpc(c, `select public.api_save_approach($1, $2, $3::jsonb)`, [tok, lead, JSON.stringify(p)]));
}
async function pending(tok: string, limit = 5) {
  return asService((c) => rpc(c, `select public.api_pending_approach($1, $2)`, [tok, limit]));
}

describe("abordagem", () => {
  let tok: string;
  let lead: string;
  beforeEach(async () => {
    await resetData();
    tok = (await tokenId((await createToken()).token))!;
    lead = (await register(tok, candidate({ diagnosis, site_status: "verificacao_pendente" }))).lead_id;
  });

  it("lista lead novo com diagnóstico e sem mensagens, com contexto", async () => {
    const r = await pending(tok);
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]).toMatchObject({ lead_id: lead, verificacao_pendente: true, city: "Votuporanga" });
    expect(r.leads[0].diagnosis.pains[0].pain).toBe("Agendamento só por telefone");
    expect(r.leads[0].evidences).toHaveLength(1);
  });

  it("grava o lote, some da fila e não duplica reenvio igual", async () => {
    expect(await save(tok, lead, lote())).toMatchObject({ status: "criado", count: 3 });
    expect((await pending(tok)).leads).toHaveLength(0);
    expect((await save(tok, lead, lote())).status).toBe("existente");
    expect(await count("lead_messages")).toBe(3);
  });

  it("pedido do painel volta o lead para a fila e gera novo lote sem apagar o anterior", async () => {
    await save(tok, lead, lote());
    await asAdmin((c) => c.query(`select public.admin_request_approach($1)`, [lead]));
    expect((await pending(tok)).leads[0].lead_id).toBe(lead);
    expect((await save(tok, lead, lote(" (novo)"))).status).toBe("criado");
    expect(await count("lead_messages")).toBe(6);
    expect((await pending(tok)).leads).toHaveLength(0);
  });

  it("edição cria versão nova e mantém a original", async () => {
    await save(tok, lead, lote());
    const orig = (await pool.query(`select id, body from lead_messages where style = 'direta'`)).rows[0];
    const novo = await asAdmin((c) => rpc(c, `select public.admin_save_message_version($1, $2)`, [orig.id, "Texto editado\ncom acento ç"]));
    expect(novo).not.toBe(orig.id);
    const rows = (await pool.query(`select body, source, parent_id from lead_messages where style = 'direta' order by created_at`)).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].body).toBe(orig.body);
    expect(rows[1]).toMatchObject({ body: "Texto editado\ncom acento ç", source: "edicao", parent_id: orig.id });
    // texto igual não cria versão
    expect(await asAdmin((c) => rpc(c, `select public.admin_save_message_version($1, $2)`, [novo, " Texto editado\ncom acento ç "]))).toBe(novo);
    await expect(asAdmin((c) => c.query(`select public.admin_save_message_version($1, $2)`, [novo, "x".repeat(501)]))).rejects.toThrow();
  });

  it("'usei esta' registra o uso e não marca o lead como contatado", async () => {
    await save(tok, lead, lote());
    const id = (await pool.query(`select id from lead_messages where style = 'pulga'`)).rows[0].id;
    await asAdmin((c) => c.query(`select public.admin_mark_message_used($1)`, [id]));
    expect(await count("lead_message_uses", `lead_id = '${lead}'`)).toBe(1);
    const l = (await pool.query(`select contacted, stage from leads where id = $1`, [lead])).rows[0];
    expect(l).toEqual({ contacted: false, stage: "novo" });
  });

  it("3 recusas tiram o lead da fila; novo pedido do painel devolve", async () => {
    for (let i = 0; i < 3; i++) await asService((c) => c.query(`select public.api_note_approach_failure($1, $2)`, [tok, lead]));
    expect((await pending(tok)).leads).toHaveLength(0);
    await asAdmin((c) => c.query(`select public.admin_request_approach($1)`, [lead]));
    expect((await pending(tok)).leads).toHaveLength(1);
  });

  it("lead inexistente é recusado", async () => {
    const r = await save(tok, "00000000-0000-4000-8000-0000000000ff", lote());
    expect(r.status).toBe("invalido");
  });

  it("não-admin não lê nem escreve; o painel não chama funções do Hermes", async () => {
    await save(tok, lead, lote());
    const id = (await pool.query(`select id from lead_messages limit 1`)).rows[0].id;
    const seen = await as("authenticated", OUTSIDER_ID, (c) => c.query(`select * from lead_messages`));
    expect(seen.rows).toHaveLength(0);
    await expect(as("authenticated", OUTSIDER_ID, (c) => c.query(`select public.admin_mark_message_used($1)`, [id]))).rejects.toThrow();
    await expect(asAdmin((c) => c.query(`select public.api_pending_approach($1, 5)`, [tok]))).rejects.toThrow(/permission/);
    await expect(asAdmin((c) => c.query(`insert into lead_messages (lead_id, batch_id, style, body, source) values ($1, gen_random_uuid(), 'direta', 'x', 'edicao')`, [lead]))).rejects.toThrow(/permission/);
    await expect(as("anon", null, (c) => c.query(`select * from lead_messages`))).rejects.toThrow(/permission/);
  });
});
