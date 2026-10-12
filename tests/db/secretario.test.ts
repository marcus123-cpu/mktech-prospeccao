import { beforeEach, describe, expect, it } from "vitest";
import { as, asAdmin, asService, candidate, count, createToken, OUTSIDER_ID, pool, register, resetData, rpc, tokenId } from "./helpers";

const diagnosis = {
  fit_score: 82,
  confidence: "media",
  summary: "Clínica de estética facial ativa, agenda só pelo WhatsApp.",
  digital_presence: "Instagram ativo, 4,8 no Google com 17 avaliações, sem site.",
  pains: [{ pain: "Agenda manual pelo WhatsApp", evidence: "Bio: 'agende pelo direct ou WhatsApp'" }],
  opportunities: ["Página com agendamento online"],
  offer: "site_com_agendamento",
  offer_reason: "Muitas mensagens para marcar horário.",
};
const msg = {
  elogio: "4,8 no Google com 17 avaliações",
  dor: "agenda manual pelo WhatsApp",
  melhoria: "página com agendamento online",
  mensagem: "Obrigado pelo retorno! Me chamo Marcos. Vi as 17 avaliações no Google. Hoje a maioria das clientes novas chega pelo Instagram ou por indicação?",
};
const PHONE = "+5517991234567";

let writer: string;
let sender: string;
const svc = <T>(sql: string, params: unknown[] = []) => asService((c) => rpc<T>(c, sql, params));
const next = () => svc<any>(`select public.api_outreach_next($1)`, [sender]);
const result = (id: string, step: string, ok = true) =>
  svc<any>(`select public.api_outreach_result($1, $2, $3, $4, $5)`, [sender, id, step, ok, ok ? null : "falha de teste"]);
const reply = (body: string, extra: Record<string, unknown> = {}) =>
  svc<any>(`select public.api_outreach_reply($1, $2::jsonb)`, [
    sender,
    JSON.stringify({ phone_e164: PHONE, body, kind: "humana", reason: "teste", opt_out: false, asks_price: false, ...extra }),
  ]);
const pending = () => svc<any>(`select public.api_secretary_pending($1, 10)`, [writer]);
const saveReply = (lead: string, p: object) => svc<any>(`select public.api_secretary_save($1, $2, $3::jsonb)`, [writer, lead, JSON.stringify(p)]);
/** Envelhece as mensagens da pessoa (o secretário espera 1 minuto) e as respostas prontas. */
const age = async () => {
  await pool.query(`update outreach_replies set received_at = received_at - interval '2 minutes'`);
  await pool.query(`update outreach_messages set sent_at = sent_at - interval '2 minutes', greeting_sent_at = greeting_sent_at - interval '2 minutes'`);
  await pool.query(`update outreach_outbound set sent_at = sent_at - interval '2 minutes'`);
  await pool.query(`update outreach_secretary set reply_ref = reply_ref - interval '2 minutes', sent_at = sent_at - interval '2 minutes',
    due_at = least(due_at, now() - interval '1 second')`);
};

async function settings(p: Record<string, unknown>) {
  await asAdmin((c) => c.query(`select public.admin_outreach_settings($1::jsonb)`, [JSON.stringify(p)]));
}
const secretary = (on: boolean) => asAdmin((c) => c.query(`select public.admin_secretary($1)`, [on]));

/** Lead que já recebeu saudação, respondeu e recebeu a mensagem personalizada. */
async function conversation(): Promise<string> {
  const r = await register(writer, candidate({ diagnosis }));
  const lead = r.lead_id as string;
  await svc(`select public.api_outreach_save($1, $2, $3::jsonb)`, [writer, lead, JSON.stringify(msg)]);
  await settings({ enabled: true, window_start: 0, window_end: 24, reply_window_start: 0, reply_window_end: 24, send_days: [1, 2, 3, 4, 5, 6, 7] });
  const g = await next();
  await result(g.id, "saudacao");
  await pool.query(`update outreach_messages set greeting_sent_at = greeting_sent_at - interval '10 minutes', sent_at = null`);
  await reply("Oi, boa tarde! Tudo bem e você?");
  await pool.query(`update outreach_replies set received_at = received_at - interval '5 minutes'`);
  await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
  const b = await next();
  expect(b.etapa).toBe("mensagem");
  await result(b.id, "mensagem");
  await pool.query(`update outreach_messages set sent_at = sent_at - interval '4 minutes'`);
  return lead;
}

describe("secretário", () => {
  beforeEach(async () => {
    await resetData();
    writer = (await tokenId((await createToken()).token, "mensagens:escrever"))!;
    const t = await asAdmin((c) => rpc<{ token: string }>(c, `select public.admin_create_sender_token('enviador')`));
    sender = (await tokenId(t.token, "envio:operar"))!;
  });

  it("vem desligado: nada para o Hermes responder e nada sai", async () => {
    const lead = await conversation();
    await reply("Pelo Instagram, quase tudo.");
    await age();
    expect(await pending()).toMatchObject({ status: "desligado", conversas: [] });
    expect((await saveReply(lead, { reply_ref: new Date().toISOString(), resposta: "Entendi!" })).status).toBe("desligado");
  });

  it("responde cada mensagem da pessoa, sem limite, com o histórico da conversa", async () => {
    const lead = await conversation();
    await secretary(true);
    expect((await pending()).conversas).toEqual([]); // ainda não há mensagem nova da pessoa

    for (let i = 1; i <= 4; i++) {
      await reply(`Mensagem ${i} da cliente`);
      expect((await pending()).conversas).toEqual([]); // espera 1 minuto: ela pode estar digitando
      await age();
      const p = await pending();
      expect(p.conversas).toHaveLength(1);
      const c = p.conversas[0];
      expect(c.lead_id).toBe(lead);
      expect(c.lead.business_name).toBeTruthy();
      expect(c.conversa.at(-1)).toMatchObject({ de: "cliente", texto: `Mensagem ${i} da cliente` });
      expect(c.conversa.filter((m: any) => m.de === "marcos").length).toBe(2 + (i - 1));
      expect((await saveReply(lead, { reply_ref: c.reply_ref, resposta: `Resposta ${i}` })).status).toBe("criada");
      // Uma resposta por mensagem dela.
      expect((await pending()).conversas).toEqual([]);
      expect((await saveReply(lead, { reply_ref: c.reply_ref, resposta: "de novo" })).status).toBe("existente");
      await age();
      const n = await next();
      expect(n).toMatchObject({ status: "enviar", etapa: "resposta", telefone: PHONE, texto: `Resposta ${i}` });
      expect((await next()).status).toBe("aguardar"); // uma etapa por vez
      expect(await result(n.id, "resposta")).toMatchObject({ message_status: "enviada" });
    }
    expect(await count("outreach_secretary", "status = 'enviada'")).toBe(4);
  });

  it("não fala no horário fora do atendimento nem com a chave geral desligada", async () => {
    const lead = await conversation();
    await secretary(true);
    await reply("Pelo Instagram.");
    await age();
    const c = (await pending()).conversas[0];
    await saveReply(lead, { reply_ref: c.reply_ref, resposta: "Entendi!" });
    await age();
    await settings({ enabled: false });
    expect((await next()).status).toBe("desligado");
    await settings({ enabled: true, reply_window_start: 0, reply_window_end: 1, window_start: 0, window_end: 1 });
    const h = Number((await pool.query(`select extract(hour from now() at time zone 'America/Sao_Paulo') as h`)).rows[0].h);
    if (h >= 1) expect((await next()).status).not.toBe("enviar");
  });

  it("mensagem nova da pessoa antes de a resposta sair: cancela e pede outra", async () => {
    const lead = await conversation();
    await secretary(true);
    await reply("Pelo Instagram.");
    await age();
    const c = (await pending()).conversas[0];
    await saveReply(lead, { reply_ref: c.reply_ref, resposta: "Entendi!" });
    await reply("Ah, e por indicação também.");
    // Resposta gravada com a conversa velha é recusada.
    expect((await saveReply(lead, { reply_ref: c.reply_ref, resposta: "x" })).status).toMatch(/desatualizada|existente/);
    await age();
    const p = await pending();
    expect(p.conversas).toHaveLength(1);
    expect(p.conversas[0].conversa.at(-1).texto).toBe("Ah, e por indicação também.");
    expect(await count("outreach_secretary", "status = 'cancelada'")).toBe(1);
    expect((await saveReply(lead, { reply_ref: p.conversas[0].reply_ref, resposta: "Entendi, as duas coisas!" })).status).toBe("criada");
    await age();
    expect((await next()).texto).toBe("Entendi, as duas coisas!");
  });

  it("passa para o Marcos: para de responder e anota no lead", async () => {
    const lead = await conversation();
    await secretary(true);
    await reply("Quanto fica?");
    await age();
    const c = (await pending()).conversas[0];
    const r = await saveReply(lead, { reply_ref: c.reply_ref, resposta: "Depende do que fizer sentido para vocês, já te explico certinho.", passar_para_marcos: "perguntou o valor" });
    expect(r).toMatchObject({ status: "criada", passada_para_marcos: true });
    const l = (await pool.query(`select secretary_handoff_reason from leads where id = $1`, [lead])).rows[0];
    expect(l.secretary_handoff_reason).toBe("perguntou o valor");
    expect(await count("lead_notes", `lead_id = '${lead}' and body like 'Secretário passou%'`)).toBe(1);
    // A resposta já gravada foi cancelada junto: com o Marcos, o secretário não fala mais.
    await age();
    expect((await next()).status).not.toBe("enviar");
    await reply("Me passa?");
    await age();
    expect((await pending()).conversas).toEqual([]);

    // O Marcos devolve a conversa: volta a responder.
    await asAdmin((c2) => c2.query(`select public.admin_secretary_return($1)`, [lead]));
    expect((await pending()).conversas).toHaveLength(1);
  });

  it("o Marcos escreveu à mão no chip: a conversa é dele", async () => {
    const lead = await conversation();
    await secretary(true);
    await svc(`select public.api_outreach_outbound($1, $2::jsonb)`, [sender, JSON.stringify({ phone_e164: PHONE, sent_at: new Date().toISOString() })]);
    await reply("Legal, me conta mais");
    await age();
    expect((await pending()).conversas).toEqual([]);
    const l = (await pool.query(`select secretary_handoff_at is not null as com_marcos from leads where id = $1`, [lead])).rows[0];
    expect(l.com_marcos).toBe(true);
  });

  it("guarda texto manual, distingue IDs e não duplica o mesmo evento", async () => {
    const lead = await conversation();
    const sent_at = new Date().toISOString();
    const manual = (body: string, external_id: string) => svc<any>(`select public.api_outreach_outbound($1, $2::jsonb)`, [
      sender, JSON.stringify({ phone_e164: PHONE, sent_at, body, media: "texto", external_id }),
    ]);
    expect((await manual("Podemos conversar amanhã?", "wa-1")).status).toBe("registrada");
    expect((await manual("Pode ser às 10h?", "wa-2")).status).toBe("registrada");
    expect((await manual("Podemos conversar amanhã?", "wa-1")).status).toBe("existente");
    const rows = await asAdmin((c) => c.query(`select body, media from conversation_timeline where lead_id = $1 and source = 'manual' order by body`, [lead]));
    expect(rows.rows).toEqual([
      { body: "Pode ser às 10h?", media: "texto" },
      { body: "Podemos conversar amanhã?", media: "texto" },
    ]);
  });

  it("pedido para parar: não responde e cancela o que estava pronto", async () => {
    const lead = await conversation();
    await secretary(true);
    await reply("Pelo Instagram.");
    await age();
    const c = (await pending()).conversas[0];
    await saveReply(lead, { reply_ref: c.reply_ref, resposta: "Entendi!" });
    await reply("Não tenho interesse", { opt_out: true });
    await age();
    expect((await next()).status).not.toBe("enviar");
    expect((await pending()).conversas).toEqual([]);
    expect(await count("outreach_secretary", "status = 'cancelada'")).toBe(1);
  });

  it("resposta sem confirmação vira falhou e não é reenviada", async () => {
    const lead = await conversation();
    await secretary(true);
    await reply("Pelo Instagram.");
    await age();
    const c = (await pending()).conversas[0];
    await saveReply(lead, { reply_ref: c.reply_ref, resposta: "Entendi!" });
    await age();
    const n = await next();
    await pool.query(`update outreach_secretary set claimed_at = now() - interval '6 minutes'`);
    expect((await next()).status).not.toBe("enviar");
    expect(await count("outreach_secretary", "status = 'falhou'")).toBe(1);
    expect((await pending()).conversas).toEqual([]);
    expect(n.etapa).toBe("resposta");
  });

  it("o painel só lê; liga e desliga só como admin", async () => {
    await expect(asService((c) => c.query(`select public.admin_secretary(true)`))).rejects.toThrow();
  });

  it("memória factual chega ao Hermes e invalida rascunhos anteriores", async () => {
    const lead = await conversation();
    await secretary(true);
    await reply("Pelo Instagram.");
    await age();
    const before = (await pending()).conversas[0];
    expect(before.memory).toEqual({});
    await saveReply(lead, { reply_ref: before.reply_ref, resposta: "Entendi!" });
    await asAdmin((c) => c.query(`select public.admin_save_conversation_memory($1, $2::jsonb)`, [lead,
      JSON.stringify({ summary: "Já usa agenda", facts: "Cliente usa agenda online", next_action: "Perguntar como chegam clientes novos" })]));
    expect(await count("outreach_secretary", "status = 'cancelada'")).toBe(1);
    const after = (await pending()).conversas[0];
    expect(after.memory.facts).toBe("Cliente usa agenda online");
    expect(after.memory).not.toHaveProperty("updated_by");
    expect(after.memory_ref).toBeTruthy();
    expect((await saveReply(lead, { reply_ref: after.reply_ref, resposta: "Contexto antigo" })).status).toBe("desatualizada");
    expect((await saveReply(lead, { reply_ref: after.reply_ref, memory_ref: after.memory_ref, resposta: "Como chegam clientes novos?" })).status).toBe("criada");
  });

  it("assumir cancela a resposta pronta e bloqueia novas respostas até devolver", async () => {
    const lead = await conversation();
    await secretary(true);
    await reply("Tenho uma dúvida");
    await age();
    const ctx = (await pending()).conversas[0];
    await saveReply(lead, { reply_ref: ctx.reply_ref, resposta: "Pode falar!" });
    await asAdmin((c) => c.query(`select public.admin_take_conversation($1)`, [lead]));
    expect(await count("outreach_secretary", "status = 'cancelada'")).toBe(1);
    expect((await pending()).conversas).toEqual([]);
    expect((await saveReply(lead, { reply_ref: ctx.reply_ref, resposta: "Outra" })).status).toBe("sem_conversa");
    await asAdmin((c) => c.query(`select public.admin_secretary_return($1)`, [lead]));
    expect((await pending()).conversas).toHaveLength(1);
  });

  it("central só considera enviados no histórico e protege dados contra não-admin", async () => {
    const lead = await conversation();
    await secretary(true);
    await reply("Pelo Instagram.");
    await age();
    const ctx = (await pending()).conversas[0];
    await saveReply(lead, { reply_ref: ctx.reply_ref, resposta: "Rascunho ainda não enviado" });
    let rows = await asAdmin((c) => c.query(`select * from conversation_timeline where lead_id = $1 order by occurred_at`, [lead]));
    expect(rows.rows.some((r) => r.body === "Rascunho ainda não enviado")).toBe(false);
    await age();
    const send = await next();
    await result(send.id, "resposta");
    rows = await asAdmin((c) => c.query(`select * from conversation_timeline where lead_id = $1`, [lead]));
    expect(rows.rows.some((r) => r.body === "Rascunho ainda não enviado")).toBe(true);
    const inbox = await asAdmin((c) => c.query(`select * from conversation_inbox where id = $1`, [lead]));
    expect(inbox.rows[0].needs_reply).toBe(false);
    await reply("E o próximo passo?");
    expect((await asAdmin((c) => c.query(`select needs_reply from conversation_inbox where id = $1`, [lead]))).rows[0].needs_reply).toBe(true);
    for (const view of ["conversation_inbox", "conversation_timeline", "lead_conversation_memory"]) {
      expect((await as("authenticated", OUTSIDER_ID, (c) => c.query(`select * from ${view}`))).rows).toEqual([]);
    }
    await expect(as("authenticated", OUTSIDER_ID, (c) => c.query(`select public.admin_take_conversation($1)`, [lead]))).rejects.toThrow();
    await expect(as("authenticated", OUTSIDER_ID, (c) => c.query(`select public.admin_save_conversation_memory($1, '{}'::jsonb)`, [lead]))).rejects.toThrow();
  });

  it("assumir recusa mensagem que já está em transporte", async () => {
    const lead = await conversation();
    await secretary(true);
    await reply("Tenho uma dúvida");
    await age();
    const ctx = (await pending()).conversas[0];
    await saveReply(lead, { reply_ref: ctx.reply_ref, resposta: "Pode falar!" });
    await age();
    expect((await next()).etapa).toBe("resposta");
    await expect(asAdmin((c) => c.query(`select public.admin_take_conversation($1)`, [lead]))).rejects.toThrow(/saindo agora/);
  });

  it("arquivar tira do funil sem apagar nada, e volta com um clique", async () => {
    const lead = await conversation();
    const col = async () =>
      (await asAdmin((c) => c.query(`select coluna from outreach_funnel where id = $1`, [lead]))).rows[0]?.coluna;
    expect(await col()).toBe("conversa");
    await asAdmin((c) => c.query(`select public.admin_funnel_archive($1, true)`, [lead]));
    expect(await col()).toBe("arquivado");
    expect(await count("outreach_messages", `lead_id = '${lead}'`)).toBe(1);
    await asAdmin((c) => c.query(`select public.admin_funnel_archive($1, false)`, [lead]));
    expect(await col()).toBe("conversa");
    await expect(
      as("authenticated", OUTSIDER_ID, (c) => c.query(`select public.admin_funnel_archive($1, true)`, [lead])),
    ).rejects.toThrow();
  });
});
