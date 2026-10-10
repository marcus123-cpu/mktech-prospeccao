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
  mensagem: "Vi que vocês têm 4,8 no Google com 17 avaliações. Hoje a agenda é pelo WhatsApp; uma página com agendamento online ajudaria. Posso mostrar uma ideia?",
};

const svc = <T>(sql: string, params: unknown[] = []) => asService((c) => rpc<T>(c, sql, params));

async function lead(overrides: Record<string, unknown> = {}) {
  const r = await register(writer, candidate({ diagnosis, ...overrides }));
  return r.lead_id as string;
}
const save = (leadId: string, p: object = msg) => svc<any>(`select public.api_outreach_save($1, $2, $3::jsonb)`, [writer, leadId, JSON.stringify(p)]);
const next = () => svc<any>(`select public.api_outreach_next($1)`, [sender]);
const result = (id: string, step: string, ok = true, err: string | null = null) =>
  svc<any>(`select public.api_outreach_result($1, $2, $3, $4, $5)`, [sender, id, step, ok, err]);
/** Por padrão a saudação "já tem 1 minuto" (resposta lenta); `fast` mantém a saudação recém-enviada. */
const reply = async (phone: string, body: string, kind = "humana", opt = false, price = false, fast = false) => {
  if (!fast) {
    await pool.query(`update outreach_messages set greeting_sent_at = least(greeting_sent_at, now() - interval '1 minute') where greeting_sent_at is not null`);
  }
  return svc<any>(`select public.api_outreach_reply($1, $2::jsonb)`, [
    sender,
    JSON.stringify({ phone_e164: phone, body, kind, reason: "teste", opt_out: opt, asks_price: price }),
  ]);
};
const column = async (leadId: string) =>
  (await asAdmin((c) => c.query(`select coluna from outreach_funnel where id = $1`, [leadId]))).rows[0]?.coluna ?? null;
async function settings(p: Record<string, unknown>) {
  await asAdmin((c) => c.query(`select public.admin_outreach_settings($1::jsonb)`, [JSON.stringify(p)]));
}
/** Liga o envio em qualquer dia e horário, sem espera entre leads. */
async function openAllDay() {
  await settings({ enabled: true, window_start: 0, window_end: 24, send_days: [1, 2, 3, 4, 5, 6, 7] });
}

let writer: string;
let sender: string;

describe("envio automático", () => {
  beforeEach(async () => {
    await resetData();
    writer = (await tokenId((await createToken()).token, "mensagens:escrever"))!;
    const t = await asAdmin((c) => rpc<{ token: string }>(c, `select public.admin_create_sender_token('enviador')`));
    sender = (await tokenId(t.token, "envio:operar"))!;
  });

  it("nasce desligado e, desligado, não reserva nada", async () => {
    const l = await lead();
    expect((await save(l)).status).toBe("criado");
    expect(await next()).toEqual({ status: "desligado" });
    expect(await count("outreach_messages", "status = 'pronta'")).toBe(1);
  });

  it("tokens têm escopos separados: o do Hermes não opera o envio e o do enviador não escreve", async () => {
    const hermes = (await createToken()).token;
    expect(await tokenId(hermes, "mensagens:escrever")).not.toBeNull();
    expect(await tokenId(hermes, "envio:operar")).toBeNull();
    const t = await asAdmin((c) => rpc<{ token: string }>(c, `select public.admin_create_sender_token('x')`));
    expect(await tokenId(t.token, "envio:operar")).not.toBeNull();
    expect(await tokenId(t.token, "candidatos:criar")).toBeNull();
    expect(await tokenId(t.token, "mensagens:escrever")).toBeNull();
  });

  it("saudação primeiro, mensagem depois do intervalo, e registra o contato", async () => {
    const l = await lead({ responsible_name: "ana paula" });
    const saved = await save(l);
    await openAllDay();

    const n1 = await next();
    expect(n1).toMatchObject({ status: "enviar", etapa: "saudacao", telefone: "+5517991234567" });
    expect(n1.texto).toMatch(/^(Bom dia|Boa tarde|Boa noite), Ana! Tudo bem\?$/);
    expect(n1.id).toBe(saved.message_id);
    // Enquanto a etapa não é confirmada, nada mais sai.
    expect((await next()).status).toBe("aguardar");

    expect(await result(n1.id, "saudacao")).toMatchObject({ message_status: "saudacao_enviada" });
    const ld = (await pool.query(`select stage, contacted from leads where id = $1`, [l])).rows[0];
    expect(ld).toEqual({ stage: "contatado", contacted: true });
    expect(await count("contact_events", `lead_id = '${l}' and source = 'envio'`)).toBe(1);

    // Sem resposta humana o texto não sai, nem por tempo.
    await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
    expect((await next()).status).not.toBe("enviar");
    await reply("+5517991234567", "Oi, boa tarde!");
    expect(await next()).toMatchObject({ status: "aguardar", motivo: "intervalo depois da saudação" });
    await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
    const n2 = await next();
    expect(n2).toMatchObject({ status: "enviar", etapa: "mensagem", texto: msg.mensagem });
    expect(await result(n2.id, "mensagem")).toMatchObject({ message_status: "enviada" });
    // Confirmação repetida não muda nada.
    expect((await result(n2.id, "mensagem")).status).toBe("existente");
  });

  it("espera o tempo de segurança entre um lead e outro", async () => {
    const a = await lead();
    const b = await lead({ business_name: "Studio Rosa", phone: "(17) 99777-1111", instagram: "@studiorosa" });
    await save(a);
    await save(b);
    await openAllDay();
    const n1 = await next();
    await result(n1.id, "saudacao");
    await reply("+5517991234567", "Oi!");
    await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
    const n2 = await next();
    await result(n2.id, "mensagem");
    const n3 = await next();
    expect(n3).toMatchObject({ status: "aguardar", motivo: "tempo de segurança entre leads" });
    expect(n3.segundos).toBeGreaterThanOrEqual(170);
    expect(n3.segundos).toBeLessThanOrEqual(300);
  });

  it("pausa vale na hora, inclusive para a mensagem de quem já recebeu a saudação", async () => {
    const l = await lead();
    await save(l);
    await openAllDay();
    const n1 = await next();
    await result(n1.id, "saudacao");
    await reply("+5517991234567", "Oi!");
    await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
    await settings({ paused: true });
    expect(await next()).toEqual({ status: "pausado" });
    await settings({ paused: false });
    expect((await next()).etapa).toBe("mensagem");
  });

  it("respeita horário, dias e limite diário", async () => {
    const l = await lead();
    await save(l);
    await settings({ enabled: true, window_start: 23, window_end: 24, send_days: [1] });
    const hourSP = (await pool.query(`select extract(hour from now() at time zone 'America/Sao_Paulo')::int as h, extract(isodow from now() at time zone 'America/Sao_Paulo')::int as d`)).rows[0];
    if (!(hourSP.h === 23 && hourSP.d === 1)) expect((await next()).status).toBe("fora_do_horario");
    await openAllDay();
    await settings({ daily_limit: 1 });
    const n1 = await next();
    await result(n1.id, "saudacao");
    await pool.query(`update outreach_messages set status = 'enviada', sent_at = now()`);
    const b = await lead({ business_name: "Studio Rosa", phone: "(17) 99777-1111", instagram: "@studiorosa" });
    await save(b);
    await pool.query(`update outreach_settings set next_send_at = null`);
    expect(await next()).toMatchObject({ status: "limite_diario", enviadas_hoje: 1 });
  });

  it("etapa sem confirmação vira falhou e não é reenviada; confirmação atrasada é aceita", async () => {
    const l = await lead();
    await save(l);
    await openAllDay();
    const n1 = await next();
    await pool.query(`update outreach_messages set claimed_at = now() - interval '6 minutes'`);
    expect((await next()).status).toBe("fila_vazia");
    const m = (await pool.query(`select status, timed_out from outreach_messages`)).rows[0];
    expect(m).toEqual({ status: "falhou", timed_out: true });
    expect((await result(n1.id, "saudacao")).message_status).toBe("saudacao_enviada");
  });

  it("falha do transporte não é reenviada", async () => {
    const l = await lead();
    await save(l);
    await openAllDay();
    const n1 = await next();
    await result(n1.id, "saudacao", false, "sem conexão");
    expect((await pool.query(`select status, error from outreach_messages`)).rows[0]).toEqual({ status: "falhou", error: "sem conexão" });
    await pool.query(`update outreach_settings set next_send_at = null`);
    expect((await next()).status).toBe("fila_vazia");
  });

  it("um lead e um telefone recebem no máximo uma abordagem", async () => {
    const l = await lead();
    expect((await save(l)).status).toBe("criado");
    expect((await save(l, { ...msg, mensagem: msg.mensagem + " " })).status).toBe("existente");
    await openAllDay();
    const n1 = await next();
    await result(n1.id, "saudacao");
    // Outro lead com o mesmo telefone não entra na fila.
    await pool.query(`update leads set stage = 'novo', contacted = false where id <> $1`, [l]);
    const other = await asAdmin((c) =>
      rpc<any>(c, `select public.admin_create_lead($1::jsonb, true)`, [
        JSON.stringify(candidate({ business_name: "Outra Clínica", instagram: "@outra", city: "Bauru" })),
      ]),
    );
    expect((await save(other.lead_id)).status).toBe("invalido");
    const pend = await svc<any>(`select public.api_outreach_pending($1, 10)`, [writer]);
    expect(pend.leads).toHaveLength(0);
  });

  it("lead contatado à mão sai da fila antes de receber qualquer coisa", async () => {
    const l = await lead();
    await save(l);
    await asAdmin((c) => c.query(`select public.admin_mark_contacted($1)`, [l]));
    await openAllDay();
    expect((await next()).status).toBe("fila_vazia");
    expect((await pool.query(`select status from outreach_messages`)).rows[0].status).toBe("cancelada");
  });

  describe("respostas", () => {
    let l: string;
    beforeEach(async () => {
      l = await lead();
      await save(l);
      await openAllDay();
      const n1 = await next();
      await result(n1.id, "saudacao");
    });

    it("automática fica registrada e não vira conversa", async () => {
      const r = await reply("+5517991234567", "Olá! Obrigado pelo contato. Em breve retornaremos.", "automatica");
      expect(r).toMatchObject({ status: "registrada", kind: "automatica", conversa: false });
      expect((await pool.query(`select stage from leads where id = $1`, [l])).rows[0].stage).toBe("contatado");
    });

    it("de pessoa move o lead para respondeu", async () => {
      const r = await reply("+5517991234567", "Oi, quem é?");
      expect(r).toMatchObject({ status: "registrada", conversa: true });
      expect((await pool.query(`select stage from leads where id = $1`, [l])).rows[0].stage).toBe("respondeu");
    });

    it("acha o lead mesmo com o número sem o nono dígito", async () => {
      expect((await reply("+551791234567", "Bom dia!")).status).toBe("registrada");
    });

    it("pedido para parar bloqueia o lead e cancela a mensagem que faltava", async () => {
      await reply("+5517991234567", "não tenho interesse", "humana", true);
      expect((await pool.query(`select do_not_contact from leads where id = $1`, [l])).rows[0].do_not_contact).toBe(true);
      expect((await pool.query(`select status from outreach_messages`)).rows[0].status).toBe("cancelada");
    });

    it("telefone que não foi abordado é ignorado e nada é guardado", async () => {
      expect((await reply("+5511988887777", "oi")).status).toBe("ignorada");
      expect(await count("outreach_replies")).toBe(0);
    });

    it("mesma mensagem repetida não duplica", async () => {
      const body = { phone_e164: "+5517991234567", body: "oi", kind: "humana", received_at: "2026-10-10T12:00:00Z" };
      const call = () => svc<any>(`select public.api_outreach_reply($1, $2::jsonb)`, [sender, JSON.stringify(body)]);
      expect((await call()).status).toBe("registrada");
      expect((await call()).status).toBe("existente");
    });

    it("admin corrige automática para pessoa", async () => {
      await reply("+5517991234567", "Seja bem-vinda! Digite 1 para agendar.", "automatica");
      const id = (await pool.query(`select id from outreach_replies`)).rows[0].id;
      await asAdmin((c) => c.query(`select public.admin_outreach_reclassify($1, 'humana')`, [id]));
      expect((await pool.query(`select stage from leads where id = $1`, [l])).rows[0].stage).toBe("respondeu");
    });
  });

  it("funil: fila, enviado, conversa, pergunta de valor, fechando e fechado", async () => {
    const l = await lead();
    expect(await column(l)).toBeNull();
    await save(l);
    expect(await column(l)).toBe("fila");
    await openAllDay();
    const n1 = await next();
    await result(n1.id, "saudacao");
    expect(await column(l)).toBe("enviado");
    await reply("+5517991234567", "Olá! Em breve retornaremos.", "automatica");
    expect(await column(l)).toBe("aguardando");
    await reply("+5517991234567", "Oi, quem é?");
    expect(await column(l)).toBe("conversa");
    await reply("+5517991234567", "Quanto custa?", "humana", false, true);
    expect(await column(l)).toBe("valor");
    await asAdmin((c) => c.query(`select public.admin_clear_price_question($1)`, [l]));
    expect(await column(l)).toBe("conversa");
    await asAdmin((c) => c.query(`select public.admin_register_proposal($1, 900, now())`, [l]));
    expect(await column(l)).toBe("fechando");
    await asAdmin((c) => c.query(`select public.admin_register_closing($1, 900, now())`, [l]));
    expect(await column(l)).toBe("fechado");
    expect((await as("authenticated", OUTSIDER_ID, (c) => c.query(`select * from outreach_funnel`))).rowCount).toBe(0);
  });

  it("áudio fica marcado no funil", async () => {
    const l = await lead();
    await save(l);
    await openAllDay();
    const n1 = await next();
    await result(n1.id, "saudacao");
    await pool.query(`update outreach_messages set greeting_sent_at = now() - interval '1 minute'`);
    await svc(`select public.api_outreach_reply($1, $2::jsonb)`, [
      sender,
      JSON.stringify({ phone_e164: "+5517991234567", body: "[áudio]", kind: "humana", media: "audio" }),
    ]);
    const row = (await asAdmin((c) => c.query(`select coluna, sent_audio from outreach_funnel where id = $1`, [l]))).rows[0];
    expect(row).toEqual({ coluna: "conversa", sent_audio: true });
  });

  it("pergunta de valor de mensagem automática não conta", async () => {
    const l = await lead();
    await save(l);
    await openAllDay();
    const n1 = await next();
    await result(n1.id, "saudacao");
    await reply("+5517991234567", "Tabela de preços: digite 2", "automatica", false, true);
    expect(await column(l)).toBe("aguardando");
  });

  describe("resposta automática segura o texto", () => {
    let l: string;
    beforeEach(async () => {
      l = await lead();
      await save(l);
      await openAllDay();
      const n1 = await next();
      await result(n1.id, "saudacao");
      await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
    });

    it("sem nenhuma resposta o texto também não sai por tempo", async () => {
      expect((await next()).status).not.toBe("enviar");
      expect(await count("outreach_messages", "sent_at is not null")).toBe(0);
    });

    it("com resposta automática o texto não sai", async () => {
      const r = await reply("+5517991234567", "Estamos fora do horário de atendimento.", "automatica");
      expect(r.segurada).toBe(true);
      expect((await next()).status).not.toBe("enviar");
      expect(await column(l)).toBe("aguardando");
      expect(await count("outreach_messages", "status = 'saudacao_enviada' and sent_at is null")).toBe(1);
    });

    it("quando uma pessoa escreve, o texto é liberado depois de uma pausa curta", async () => {
      await reply("+5517991234567", "Estamos fora do horário de atendimento.", "automatica");
      await reply("+5517991234567", "Oi! Pode falar.");
      expect(await column(l)).toBe("conversa");
      const due = (await pool.query(`select held_at, body_due_at > now() as futuro from outreach_messages`)).rows[0];
      expect(due.held_at).toBeNull();
      expect(due.futuro).toBe(true);
      await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
      expect((await next()).etapa).toBe("mensagem");
    });

    it("resposta até 15 s depois da saudação conta como automática, mesmo com cara de pessoa", async () => {
      const r = await reply("+5517991234567", "Oi, tudo bem? Aqui é a Lia, secretária da doutora. Qual a sua queixa?", "humana", false, false, true);
      expect(r.kind).toBe("automatica");
      expect(r.segurada).toBe(true);
      expect(r.conversa).toBe(false);
      expect(await column(l)).toBe("aguardando");
      expect((await next()).status).not.toBe("enviar");
      expect(await count("outreach_messages", "sent_at is not null")).toBe(0);
      const row = (await pool.query(`select kind, reason from outreach_replies`)).rows[0];
      expect(row.kind).toBe("automatica");
      expect(row.reason).toContain("15 s");
    });

    it("resposta que chegou antes da confirmação do envio (relógio) também é automática", async () => {
      const g = (await pool.query(`select greeting_sent_at from outreach_messages`)).rows[0].greeting_sent_at as Date;
      const r = await svc<any>(`select public.api_outreach_reply($1, $2::jsonb)`, [
        sender,
        JSON.stringify({ phone_e164: "+5517991234567", body: "Olá! Aqui é a secretária.", kind: "humana", received_at: new Date(g.getTime() - 2000).toISOString() }),
      ]);
      expect(r.kind).toBe("automatica");
      expect(await column(l)).toBe("aguardando");
    });

    it("mensagem sem texto (evento do WhatsApp Business) não libera o texto", async () => {
      await pool.query(`update outreach_messages set greeting_sent_at = now() - interval '1 minute'`);
      const r = await svc<any>(`select public.api_outreach_reply($1, $2::jsonb)`, [
        sender,
        JSON.stringify({ phone_e164: "+5517991234567", body: "[mensagem sem texto]", kind: "humana", media: "outro" }),
      ]);
      expect(r.kind).toBe("automatica");
      await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
      expect((await next()).status).not.toBe("enviar");
    });

    it("caso da Carol Rodrigues: evento sem texto 2 s antes da confirmação não libera; a pessoa de verdade libera", async () => {
      const g = (await pool.query(`select greeting_sent_at from outreach_messages`)).rows[0].greeting_sent_at as Date;
      const early = await svc<any>(`select public.api_outreach_reply($1, $2::jsonb)`, [
        sender,
        JSON.stringify({ phone_e164: "+5517991234567", body: "[mensagem sem texto]", kind: "humana", media: "outro", received_at: new Date(g.getTime() - 2000).toISOString() }),
      ]);
      expect(early.kind).toBe("automatica");
      await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
      for (let i = 0; i < 3; i++) expect((await next()).status).not.toBe("enviar");
      expect(await count("outreach_messages", "sent_at is not null")).toBe(0);
      expect(await column(l)).toBe("aguardando");
      // 1 minuto depois uma pessoa escreve
      await svc<any>(`select public.api_outreach_reply($1, $2::jsonb)`, [
        sender,
        JSON.stringify({ phone_e164: "+5517991234567", body: "Oi! Pode falar.", kind: "humana", received_at: new Date(g.getTime() + 60_000).toISOString() }),
      ]);
      expect(await column(l)).toBe("conversa");
      await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
      expect((await next()).etapa).toBe("mensagem");
    });

    it("limite exato: 15 s é automática e 16 s é pessoa", async () => {
      const g = (await pool.query(`select greeting_sent_at from outreach_messages`)).rows[0].greeting_sent_at as Date;
      const at = (s: number, body: string) =>
        svc<any>(`select public.api_outreach_reply($1, $2::jsonb)`, [
          sender,
          JSON.stringify({ phone_e164: "+5517991234567", body, kind: "humana", received_at: new Date(g.getTime() + s * 1000).toISOString() }),
        ]);
      expect((await at(15, "Olá, tudo bem?")).kind).toBe("automatica");
      expect((await at(16, "Oi, sou eu mesmo, pode falar")).kind).toBe("humana");
    });

    it("várias respostas rápidas seguidas continuam segurando, e só a lenta libera", async () => {
      for (const body of ["Olá!", "Menu: digite 1", "Qual seu nome completo?", "[mensagem sem texto]"]) {
        const r = await reply("+5517991234567", body, "humana", false, false, true);
        expect(r.kind).toBe("automatica");
      }
      await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
      expect((await next()).status).not.toBe("enviar");
      await pool.query(`update outreach_messages set greeting_sent_at = now() - interval '2 minutes'`);
      await reply("+5517991234567", "Oi, aqui é a dra. Pode me contar.", "humana", false, false, true);
      await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
      expect((await next()).etapa).toBe("mensagem");
    });

    it("pessoa só libera depois da pausa de 45 s, e o texto sai uma única vez", async () => {
      await reply("+5517991234567", "Oi! Pode falar.");
      expect((await next()).status).toBe("aguardar"); // pausa curta ainda não passou
      await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
      const n = await next();
      expect(n.etapa).toBe("mensagem");
      await result(n.id, "mensagem");
      await result(n.id, "mensagem"); // confirmação repetida não duplica
      expect(await count("outreach_messages", "status = 'enviada'")).toBe(1);
      expect((await next()).status).not.toBe("enviar");
      // resposta depois do texto não reabre nada
      await reply("+5517991234567", "Obrigada, vou ver.");
      expect((await next()).status).not.toBe("enviar");
    });

    it("sem nenhuma resposta nem 2 dias úteis depois o texto sai (só vai para Sem resposta)", async () => {
      await pool.query(`update outreach_messages set greeting_sent_at = now() - interval '30 days'`);
      for (let i = 0; i < 3; i++) expect((await next()).status).not.toBe("enviar");
      expect(await column(l)).toBe("sem_resposta");
      expect(await count("outreach_messages", "sent_at is not null")).toBe(0);
    });

    it("resposta de outro telefone não libera o texto deste lead", async () => {
      expect((await reply("+5517999990000", "Oi, pode falar")).status).toBe("ignorada");
      await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
      expect((await next()).status).not.toBe("enviar");
    });

    it("resposta de áudio lenta é pessoa e libera; áudio rápido não", async () => {
      const fast = await svc<any>(`select public.api_outreach_reply($1, $2::jsonb)`, [
        sender,
        JSON.stringify({ phone_e164: "+5517991234567", body: "[áudio]", kind: "humana", media: "audio" }),
      ]);
      expect(fast.kind).toBe("automatica");
      await pool.query(`update outreach_messages set greeting_sent_at = now() - interval '1 minute'`);
      const slow = await svc<any>(`select public.api_outreach_reply($1, $2::jsonb)`, [
        sender,
        JSON.stringify({ phone_e164: "+5517991234567", body: "[áudio]", kind: "humana", media: "audio", received_at: new Date(Date.now() + 1000).toISOString() }),
      ]);
      expect(slow.kind).toBe("humana");
    });

    it("resposta mais lenta que 15 s continua valendo como pessoa", async () => {
      await pool.query(`update outreach_messages set greeting_sent_at = now() - interval '20 seconds'`);
      const r = await reply("+5517991234567", "Oi! Pode falar.", "humana", false, false, true);
      expect(r.kind).toBe("humana");
      expect(r.conversa).toBe(true);
      expect(await column(l)).toBe("conversa");
    });

    it("pedido para parar vale mesmo se chegar em até 15 s", async () => {
      const r = await reply("+5517991234567", "Não quero receber mensagens, por favor.", "humana", true, false, true);
      expect(r.opt_out).toBe(true);
      expect(await count("leads", "do_not_contact")).toBe(1);
    });

    it("corrigir para pessoa também libera", async () => {
      await reply("+5517991234567", "Seja bem-vinda! Digite 1.", "automatica");
      const id = (await pool.query(`select id from outreach_replies`)).rows[0].id;
      await asAdmin((c) => c.query(`select public.admin_outreach_reclassify($1, 'humana')`, [id]));
      await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
      expect((await next()).etapa).toBe("mensagem");
    });

    it("sem pessoa em 2 dias úteis vai para Sem resposta e nada é enviado", async () => {
      await reply("+5517991234567", "Estamos fora do horário de atendimento.", "automatica");
      await pool.query(`update outreach_messages set greeting_sent_at = now() - interval '5 days'`);
      const n = await next();
      expect(n.status).not.toBe("enviar");
      expect(await column(l)).toBe("sem_resposta");
      expect(await count("outreach_messages", "sent_at is not null")).toBe(0);
      // se a pessoa aparecer depois, o texto volta a sair
      await reply("+5517991234567", "Desculpa a demora, pode falar.");
      await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
      expect((await next()).etapa).toBe("mensagem");
    });

    it("soma dias úteis pulando o fim de semana", async () => {
      const r = await pool.query(
        `select public.outreach_add_business_days('2026-10-09 15:00-03', 2) as d`,
      );
      expect(new Date(r.rows[0].d).toISOString()).toBe("2026-10-13T18:00:00.000Z");
    });
  });

  it("3 recusas tiram o lead da fila do Hermes até o admin liberar", async () => {
    const l = await lead();
    for (let i = 0; i < 3; i++) {
      await svc(`select public.api_outreach_note_failure($1, $2, 'texto técnico')`, [writer, l]);
    }
    expect((await svc<any>(`select public.api_outreach_pending($1, 10)`, [writer])).leads).toHaveLength(0);
    await asAdmin((c) => c.query(`select public.admin_outreach_retry($1)`, [l]));
    expect((await svc<any>(`select public.api_outreach_pending($1, 10)`, [writer])).leads).toHaveLength(1);
  });

  it("pendentes respeitam nota mínima e exigem diagnóstico e telefone", async () => {
    await lead();
    await register(writer, candidate({ business_name: "Sem Diag", phone: "(17) 99555-0000", instagram: "@semdiag" }));
    await register(writer, candidate({ business_name: "Nota Baixa", phone: "(17) 99555-1111", instagram: "@baixa", diagnosis: { ...diagnosis, fit_score: 30 } }));
    const pend = await svc<any>(`select public.api_outreach_pending($1, 10)`, [writer]);
    expect(pend.leads.map((x: any) => x.business_name)).toEqual(["Clínica Bella Pelle"]);
  });

  it("saudação conforme a hora de São Paulo", async () => {
    const g = async (ts: string, name: string | null) =>
      (await pool.query(`select public.outreach_greeting($1::timestamp, $2) as g`, [ts, name])).rows[0].g;
    expect(await g("2026-10-10 05:00", "maria")).toBe("Bom dia, Maria! Tudo bem?");
    expect(await g("2026-10-10 11:59", null)).toBe("Bom dia! Tudo bem?");
    expect(await g("2026-10-10 12:00", null)).toBe("Boa tarde! Tudo bem?");
    expect(await g("2026-10-10 18:00", null)).toBe("Boa noite! Tudo bem?");
    expect(await g("2026-10-10 02:00", "  ")).toBe("Boa noite! Tudo bem?");
  });

  it("só admin lê a fila e as respostas; navegador não chama as funções do enviador", async () => {
    await save(await lead());
    expect((await asAdmin((c) => c.query(`select * from outreach_messages`))).rowCount).toBe(1);
    expect((await as("authenticated", OUTSIDER_ID, (c) => c.query(`select * from outreach_messages`))).rowCount).toBe(0);
    await expect(as("anon", null, (c) => c.query(`select * from outreach_replies`))).rejects.toThrow();
    await expect(asAdmin((c) => c.query(`select public.api_outreach_next($1)`, [sender]))).rejects.toThrow();
    await expect(as("authenticated", OUTSIDER_ID, (c) => c.query(`select public.admin_outreach_settings('{"enabled": true}')`))).rejects.toThrow();
  });

  describe("lembretes para quem parou de responder", () => {
    const PHONE = "+5517991234567";
    let l: string;
    const outbound = (daysAgo: number, phone = PHONE) =>
      svc<any>(`select public.api_outreach_outbound($1, $2::jsonb)`, [
        sender,
        JSON.stringify({ phone_e164: phone, sent_at: new Date(Date.now() - daysAgo * 86400_000).toISOString() }),
      ]);
    const clearWait = () => pool.query(`update outreach_settings set next_send_at = null`);
    const followupsOn = () => asAdmin((c) => c.query(`select public.admin_outreach_followups(true)`));
    /** Envia o lembrete que o enviador pedir e confirma. */
    async function sendFollowup(ok = true) {
      await clearWait();
      const n = await next();
      expect(n.etapa).toBe("lembrete");
      await result(n.id, "lembrete", ok, ok ? null : "falha de teste");
      return n;
    }
    /** Empurra o relógio dos lembretes N dias para trás (dias corridos folgados). */
    const age = (days: number) =>
      pool.query(
        `update outreach_followups set sent_at = sent_at - make_interval(days => $1), claimed_at = claimed_at - make_interval(days => $1)`,
        [days],
      );

    beforeEach(async () => {
      l = await lead();
      await save(l);
      await openAllDay();
      const n1 = await next();
      await result(n1.id, "saudacao");
      await reply(PHONE, "Oi, pode falar.");
      await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
      const n2 = await next();
      await result(n2.id, "mensagem");
      // a conversa já tem 12 dias; o Marcos respondeu há 10
      await pool.query(`update outreach_replies set received_at = now() - interval '12 days'`);
      await clearWait();
    });

    it("vem desligado: sem a chave dos lembretes nada sai", async () => {
      await outbound(10);
      expect((await next()).status).toBe("fila_vazia");
    });

    it("sem mensagem nossa depois da resposta do cliente, o Marcos é quem deve: nada sai", async () => {
      await followupsOn();
      expect((await next()).status).toBe("fila_vazia");
    });

    it("1º lembrete sai 2 dias úteis depois da mensagem do Marcos, sem preço", async () => {
      await followupsOn();
      await outbound(1); // ainda não passaram 2 dias úteis
      await pool.query(`update outreach_outbound set sent_at = now() - interval '30 minutes'`);
      expect((await next()).status).toBe("fila_vazia");
      await pool.query(`update outreach_outbound set sent_at = now() - interval '10 days'`);
      const n = await sendFollowup();
      expect(n.texto).toBe("Oi! Você gostou da minha proposta?");
      expect(n.texto).not.toMatch(/R\$|\d+,\d{2}/);
      expect(await column(l)).toBe("lembrando");
      expect((await next()).status).not.toBe("enviar");
    });

    it("2º lembrete depois de mais 2 dias úteis, e depois encerra o lead", async () => {
      await followupsOn();
      await outbound(10);
      await sendFollowup();
      await age(10);
      const n2 = await sendFollowup();
      expect(n2.texto).toContain("você viu minha mensagem");
      expect(await column(l)).toBe("lembrando");
      // sem um 3º lembrete: passa o tempo e o lead é encerrado
      await age(10);
      await clearWait();
      expect((await next()).status).not.toBe("enviar");
      expect(await column(l)).toBe("sem_retorno");
      expect(await count("outreach_followups")).toBe(2);
      await age(30);
      await clearWait();
      expect((await next()).status).not.toBe("enviar");
    });

    it("resposta do cliente para tudo e devolve a conversa ao Marcos", async () => {
      await followupsOn();
      await outbound(10);
      await sendFollowup();
      await reply(PHONE, "Oi! Vi sim, me manda mais detalhes.");
      expect(await column(l)).toBe("conversa");
      await age(10);
      await clearWait();
      expect((await next()).status).not.toBe("enviar");
    });

    it("resposta depois de encerrado reabre a conversa e zera o ciclo", async () => {
      await followupsOn();
      await outbound(10);
      await sendFollowup();
      await age(10);
      await sendFollowup();
      await age(10);
      await clearWait();
      await next();
      expect(await column(l)).toBe("sem_retorno");
      await reply(PHONE, "Desculpa o sumiço! Podemos conversar?");
      expect(await column(l)).toBe("conversa");
      expect((await pool.query(`select followup_closed_at from leads where id = $1`, [l])).rows[0].followup_closed_at).toBeNull();
    });

    it("lembrete que falha não é reenviado", async () => {
      await followupsOn();
      await outbound(10);
      await sendFollowup(false);
      await clearWait();
      expect((await next()).status).not.toBe("enviar");
      expect(await count("outreach_followups", "status = 'falhou'")).toBe(1);
    });

    it("lembrete sem confirmação em 5 minutos falha e não é reenviado", async () => {
      await followupsOn();
      await outbound(10);
      await clearWait();
      expect((await next()).etapa).toBe("lembrete");
      await pool.query(`update outreach_followups set claimed_at = now() - interval '6 minutes'`);
      expect((await next()).status).not.toBe("enviar");
      expect(await count("outreach_followups", "status = 'falhou'")).toBe(1);
    });

    it("quem pediu para parar nunca recebe lembrete", async () => {
      await followupsOn();
      await outbound(10);
      await reply(PHONE, "Não quero mais receber mensagens, por favor.", "humana", true);
      await pool.query(`update outreach_replies set received_at = now() - interval '12 days'`);
      await clearWait();
      expect((await next()).status).not.toBe("enviar");
      expect(await count("outreach_followups")).toBe(0);
    });

    it("respeita horário e limite diário", async () => {
      await followupsOn();
      await outbound(10);
      await settings({ window_start: 3, window_end: 4 });
      await pool.query(`update outreach_settings set send_days = '{1,2,3,4,5,6,7}'`);
      const hour = Number((await pool.query(`select extract(hour from now() at time zone 'America/Sao_Paulo') as h`)).rows[0].h);
      if (hour !== 3) expect((await next()).status).toBe("fora_do_horario");
      await openAllDay();
      await pool.query(`update outreach_settings set daily_limit = 1`);
      await clearWait();
      expect((await next()).status).toBe("limite_diario");
    });

    it("mensagem do Marcos para telefone desconhecido é ignorada e duplicada é idempotente", async () => {
      expect((await outbound(1, "+5517999990000")).status).toBe("ignorada");
      expect((await outbound(5)).status).toBe("registrada");
      const sentAt = (await pool.query(`select sent_at from outreach_outbound`)).rows[0].sent_at;
      const again = await svc<any>(`select public.api_outreach_outbound($1, $2::jsonb)`, [
        sender,
        JSON.stringify({ phone_e164: PHONE, sent_at: sentAt.toISOString() }),
      ]);
      expect(again.status).toBe("existente");
    });

    it("só admin liga os lembretes", async () => {
      await expect(as("authenticated", OUTSIDER_ID, (c) => c.query(`select public.admin_outreach_followups(true)`))).rejects.toThrow();
      await expect(asAdmin((c) => c.query(`select public.api_outreach_outbound($1, '{}'::jsonb)`, [sender]))).rejects.toThrow();
    });
  });

});
