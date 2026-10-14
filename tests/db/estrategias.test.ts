import { beforeEach, describe, expect, it } from "vitest";
import { as, asAdmin, asService, candidate, count, createToken, OUTSIDER_ID, pool, register, resetData, rpc, tokenId } from "./helpers";

const diagnosis = {
  fit_score: 82,
  confidence: "media",
  summary: "Clínica de estética facial ativa, agenda só pelo WhatsApp.",
  digital_presence: "Instagram ativo, 4,8 no Google com 17 avaliações.",
  pains: [{ pain: "Agenda manual pelo WhatsApp", evidence: "Bio: 'agende pelo direct ou WhatsApp'" }],
  opportunities: ["Página com agendamento online"],
  offer: "site_com_agendamento",
  offer_reason: "Muitas mensagens para marcar horário.",
};
const msg = (estrategia: string | null = "A") => ({
  elogio: "4,8 no Google com 17 avaliações",
  dor: "agenda manual pelo WhatsApp",
  melhoria: "página com agendamento online",
  mensagem: "Sou o Marcos, da MKTech Dev. Trabalho com soluções digitais para clínicas de estética. Tive uma ideia para apresentar os tratamentos de vocês. Posso te mostrar rapidinho?",
  ...(estrategia ? { estrategia, motivo_estrategia: "teste", estrato: "ricos-instagram", modo_estrategia: "teste" } : {}),
});

const svc = <T>(sql: string, params: unknown[] = []) => asService((c) => rpc<T>(c, sql, params));
let writer: string;
let sender: string;
let n = 0;

async function lead() {
  const i = n++;
  const r = await register(writer, candidate({ diagnosis, business_name: `Clínica ${["Aurora", "Jasmim", "Safira", "Opala", "Rubi"][i]}`, phone: `(17) 9${8100 + i}-${2000 + i}`, instagram: `@abc.${i}` }));
  return r.lead_id as string;
}
const save = (leadId: string, p: object = msg()) => svc<any>(`select public.api_outreach_save($1, $2, $3::jsonb)`, [writer, leadId, JSON.stringify(p)]);
const next = () => svc<any>(`select public.api_outreach_next($1)`, [sender]);
const result = (id: string, step: string) => svc<any>(`select public.api_outreach_result($1, $2, $3, true, null)`, [sender, id, step]);
const phoneOf = async (leadId: string) => (await pool.query(`select phone_e164 from leads where id = $1`, [leadId])).rows[0].phone_e164;
const leadRow = async (leadId: string) => (await pool.query(`select * from leads where id = $1`, [leadId])).rows[0];
const events = async (leadId: string) =>
  (await pool.query(`select field, old_value, new_value, source from lead_commercial_events where lead_id = $1 order by created_at, id`, [leadId])).rows;
async function reply(leadId: string, body: string, extra: object = {}) {
  await pool.query(`update outreach_messages set greeting_sent_at = least(greeting_sent_at, now() - interval '1 minute') where greeting_sent_at is not null`);
  return svc<any>(`select public.api_outreach_reply($1, $2::jsonb)`, [
    sender,
    JSON.stringify({ phone_e164: await phoneOf(leadId), body, kind: "humana", reason: "teste", opt_out: false, asks_price: false, ...extra }),
  ]);
}
const annotate = (replyId: string, p: object) => svc<any>(`select public.api_reply_annotate($1, $2, $3::jsonb)`, [writer, replyId, JSON.stringify(p)]);
const approval = (on: boolean) => asAdmin((c) => c.query(`select public.admin_outreach_require_approval($1)`, [on]));
const approve = (kind: string, id: string) => asAdmin((c) => c.query(`select public.admin_outreach_approve($1, $2)`, [kind, id]));
const reject = (kind: string, id: string) => asAdmin((c) => c.query(`select public.admin_outreach_reject($1, $2, 'texto genérico')`, [kind, id]));
async function greet() {
  await pool.query(`update outreach_settings set next_send_at = null`);
  const r = await next();
  expect(r.etapa).toBe("saudacao");
  await result(r.id, "saudacao");
  return r;
}

describe("estratégias A/B/C e fluxo comercial", () => {
  beforeEach(async () => {
    await resetData();
    n = 0;
    writer = (await tokenId((await createToken()).token, "mensagens:escrever"))!;
    const t = await asAdmin((c) => rpc<{ token: string }>(c, `select public.admin_create_sender_token('enviador')`));
    sender = (await tokenId(t.token, "envio:operar"))!;
    await asAdmin((c) =>
      c.query(`select public.admin_outreach_settings($1::jsonb)`, [
        JSON.stringify({ enabled: true, window_start: 0, window_end: 24, reply_window_start: 0, reply_window_end: 24, send_days: [1, 2, 3, 4, 5, 6, 7] }),
      ]),
    );
  });

  it("grava a estratégia na mensagem e no lead, com histórico; sem estratégia continua funcionando", async () => {
    const a = await lead();
    expect(await save(a)).toMatchObject({ status: "criado", estrategia: "A" });
    const m = (await pool.query(`select strategy, strategy_stratum, strategy_mode from outreach_messages where lead_id = $1`, [a])).rows[0];
    expect(m).toEqual({ strategy: "A", strategy_stratum: "ricos-instagram", strategy_mode: "teste" });
    expect((await leadRow(a)).prospect_strategy).toBe("A");
    expect(await events(a)).toEqual([{ field: "estrategia", old_value: null, new_value: "A", source: "hermes" }]);

    const antiga = await lead();
    expect(await save(antiga, msg(null))).toMatchObject({ status: "criado", estrategia: null });
    expect((await leadRow(antiga)).prospect_strategy).toBeNull();
    expect((await save(await lead(), msg("D"))).status).toBe("invalido");

    const counts = await svc<any[]>(`select public.api_outreach_strategy_counts($1)`, [writer]);
    expect(counts).toEqual([{ estrategia: "A", estrato: "ricos-instagram", n: 1 }]);
  });

  it("lead duplicado: segunda mensagem para o mesmo lead não entra na fila", async () => {
    const a = await lead();
    await save(a);
    expect((await save(a, msg("B"))).status).toBe("existente");
    expect(await count("outreach_messages", `lead_id = '${a}'`)).toBe(1);
    expect((await leadRow(a)).prospect_strategy).toBe("A");
  });

  it("saudação enviada marca o primeiro contato; resposta classificada avança o estado e o papel", async () => {
    const a = await lead();
    await save(a);
    await greet();
    let l = await leadRow(a);
    expect(l.conversation_state).toBe("primeiro_contato");
    expect(l.first_contact_at).not.toBeNull();

    const r = await reply(a, "Oi! Sou a recepcionista. Do que se trata?");
    expect((await annotate(r.reply_id, { intencao: "esclarecimento", papel: "recepcionista", estado: "resposta_recebida" })).status).toBe("ok");
    l = await leadRow(a);
    expect(l).toMatchObject({ conversation_state: "resposta_recebida", contact_role: "recepcionista", decision_maker_at: null });
    const saved = (await pool.query(`select intent, contact_role from outreach_replies where id = $1`, [r.reply_id])).rows[0];
    expect(saved).toEqual({ intent: "esclarecimento", contact_role: "recepcionista" });

    // A proprietária assume no mesmo número.
    const r2 = await reply(a, "Oi, sou a dona da clínica, pode falar comigo");
    await annotate(r2.reply_id, { intencao: "positiva", papel: "proprietaria", estado: "qualificacao" });
    l = await leadRow(a);
    expect(l.contact_role).toBe("proprietaria");
    expect(l.decision_maker_at).not.toBeNull();
    expect(l.furthest_state_rank).toBe(3);
  });

  it("histórico: estado automático nunca volta, e nada é sobrescrito sem registro", async () => {
    const a = await lead();
    await save(a);
    await greet();
    const r = await reply(a, "Quanto custa?", { asks_price: true });
    await annotate(r.reply_id, { intencao: "positiva", papel: "proprietaria", estado: "negociacao", interesse: "alto" });
    const r2 = await reply(a, "ok");
    await annotate(r2.reply_id, { intencao: "neutra", papel: "desconhecido", estado: "resposta_recebida", interesse: "baixo" });
    const l = await leadRow(a);
    expect(l).toMatchObject({ conversation_state: "negociacao", contact_role: "proprietaria", commercial_interest: "alto", furthest_state_rank: 7 });
    const ev = await events(a);
    expect(ev.filter((e) => e.field === "estado").map((e) => e.new_value)).toEqual(["primeiro_contato", "negociacao"]);
    // O Marcos pode corrigir para trás; a correção vira uma linha nova.
    await asAdmin((c) => c.query(`select public.admin_update_commercial($1, $2::jsonb)`, [a, JSON.stringify({ estado: "qualificacao", nota: "ainda avaliando" })]));
    expect((await leadRow(a)).conversation_state).toBe("qualificacao");
    expect((await leadRow(a)).furthest_state_rank).toBe(7);
    expect((await events(a)).at(-1)).toMatchObject({ field: "estado", old_value: "negociacao", new_value: "qualificacao", source: "marcos" });
  });

  it("mensagem automática: registra atendimento automático e não avança", async () => {
    const a = await lead();
    await save(a);
    await greet();
    const r = await reply(a, "Obrigado pelo contato! Retornaremos em breve.", { kind: "automatica" });
    await annotate(r.reply_id, { intencao: "positiva", papel: "proprietaria", estado: "qualificacao" });
    const l = await leadRow(a);
    expect(l).toMatchObject({ conversation_state: "primeiro_contato", contact_role: "automatico" });
    expect((await pool.query(`select intent from outreach_replies where id = $1`, [r.reply_id])).rows[0].intent).toBe("automatica");
  });

  it("pedido para interromper contato: encerra, bloqueia e não reabre sozinho", async () => {
    const a = await lead();
    await save(a);
    await greet();
    const r = await reply(a, "Não me mandem mais mensagens", { opt_out: true });
    await annotate(r.reply_id, { intencao: "negativa", papel: "desconhecido", estado: "encerrado" });
    let l = await leadRow(a);
    expect(l).toMatchObject({ conversation_state: "encerrado", do_not_contact: true, commercial_interest: "nenhum" });
    const r2 = await reply(a, "Quanto custa?");
    if (r2.reply_id) await annotate(r2.reply_id, { intencao: "positiva", estado: "negociacao" });
    l = await leadRow(a);
    expect(l.conversation_state).toBe("encerrado");
  });

  it("vídeo: oferecido, autorizado e enviado ficam com data uma vez só", async () => {
    const a = await lead();
    await svc(`select public.api_commercial_update($1, $2, $3::jsonb)`, [writer, a, JSON.stringify({ video: "oferecido", estado: "video" })]);
    await svc(`select public.api_commercial_update($1, $2, $3::jsonb)`, [writer, a, JSON.stringify({ video: "autorizado" })]);
    const first = (await leadRow(a)).video_authorized_at;
    await svc(`select public.api_commercial_update($1, $2, $3::jsonb)`, [writer, a, JSON.stringify({ video: "autorizado" })]);
    expect((await leadRow(a)).video_authorized_at).toEqual(first);
    // O Hermes não troca a estratégia nem o motivo de perda.
    await svc(`select public.api_commercial_update($1, $2, $3::jsonb)`, [writer, a, JSON.stringify({ estrategia: "C", motivo_perda: "x" })]);
    expect((await leadRow(a)).prospect_strategy).toBeNull();
    await asAdmin((c) => c.query(`select public.admin_update_commercial($1, $2::jsonb)`, [a, JSON.stringify({ video: "enviado" })]));
    expect((await leadRow(a)).video_sent_at).not.toBeNull();
    expect((await events(a)).filter((e) => e.field === "video").map((e) => e.new_value)).toEqual(["oferecido", "autorizado", "enviado"]);
  });

  it("métricas por estratégia contam contatos, respostas e oportunidades; antigas ficam separadas", async () => {
    const a = await lead();
    const b = await lead();
    const antiga = await lead();
    await save(a, msg("A"));
    await save(b, msg("C"));
    await save(antiga, msg(null));
    await greet();
    await greet();
    await greet();
    const r = await reply(a, "Sim, pode mostrar");
    await annotate(r.reply_id, { intencao: "positiva", papel: "proprietaria", estado: "video", video: "autorizado" });
    await asAdmin((c) => c.query(`select public.admin_update_commercial($1, $2::jsonb)`, [a, JSON.stringify({ estado: "oportunidade" })]));
    const rows = await asAdmin(async (c) => (await c.query(`select * from strategy_metrics order by estrategia`)).rows);
    const byKey = Object.fromEntries(rows.map((x: any) => [x.estrategia, x]));
    expect(byKey.A).toMatchObject({ contatados: 1, respostas_humanas: 1, respostas_positivas: 1, decisores: 1, videos_autorizados: 1, oportunidades: 1 });
    expect(byKey.C).toMatchObject({ contatados: 1, respostas_humanas: 0, oportunidades: 0 });
    expect(byKey.antiga).toMatchObject({ contatados: 1 });
    await expect(as("authenticated", OUTSIDER_ID, async (c) => (await c.query(`select * from strategy_metrics`)).rows)).resolves.toEqual([]);
  });
});

describe("trava de aprovação", () => {
  beforeEach(async () => {
    await resetData();
    n = 0;
    writer = (await tokenId((await createToken()).token, "mensagens:escrever"))!;
    const t = await asAdmin((c) => rpc<{ token: string }>(c, `select public.admin_create_sender_token('enviador')`));
    sender = (await tokenId(t.token, "envio:operar"))!;
    await asAdmin((c) =>
      c.query(`select public.admin_outreach_settings($1::jsonb)`, [
        JSON.stringify({ enabled: true, window_start: 0, window_end: 24, reply_window_start: 0, reply_window_end: 24, send_days: [1, 2, 3, 4, 5, 6, 7] }),
      ]),
    );
  });

  it("começa desligada: o envio segue igual", async () => {
    expect((await pool.query(`select require_approval from outreach_settings`)).rows[0].require_approval).toBe(false);
    const a = await lead();
    await save(a);
    expect((await next()).etapa).toBe("saudacao");
  });

  it("ligada: nada sai sem aprovação; aprovar libera saudação e texto; recusar cancela", async () => {
    await approval(true);
    const a = await lead();
    const b = await lead();
    const ma = (await save(a)).message_id;
    const mb = (await save(b)).message_id;
    expect(await next()).toMatchObject({ status: "aguardando_aprovacao" });

    await reject("mensagem", mb);
    expect((await pool.query(`select status from outreach_messages where id = $1`, [mb])).rows[0].status).toBe("cancelada");
    await approve("mensagem", ma);
    await greet();
    await reply(a, "Oi, boa tarde!");
    await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
    const body = await next();
    expect(body).toMatchObject({ etapa: "mensagem", id: ma });
    await expect(approve("mensagem", ma)).rejects.toThrow();
  });

  it("ligada depois da saudação: o texto espera o clique", async () => {
    const a = await lead();
    const ma = (await save(a)).message_id;
    await greet();
    await approval(true);
    await reply(a, "Oi, boa tarde!");
    await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second'`);
    expect((await next()).etapa).toBeUndefined();
    await approve("texto", ma);
    expect(await next()).toMatchObject({ etapa: "mensagem", id: ma });
  });

  it("só o admin liga a trava e aprova", async () => {
    await expect(as("authenticated", OUTSIDER_ID, (c) => c.query(`select public.admin_outreach_require_approval(true)`))).rejects.toThrow();
    await expect(asService((c) => c.query(`select public.admin_outreach_require_approval(true)`))).rejects.toThrow();
    const a = await lead();
    const ma = (await save(a)).message_id;
    await expect(as("authenticated", OUTSIDER_ID, (c) => c.query(`select public.admin_outreach_approve('mensagem', $1)`, [ma]))).rejects.toThrow();
  });
});
