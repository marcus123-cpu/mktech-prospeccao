import { beforeEach, describe, expect, it } from "vitest";
import { as, asAdmin, asService, candidate, createToken, OUTSIDER_ID, pool, register, resetData, rpc, tokenId } from "./helpers";

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
  mensagem: "Obrigado pelo retorno! Me chamo Marcos. Vi que vocês têm 4,8 no Google com 17 avaliações. Como as clientes novas costumam chegar até vocês?",
};

const svc = <T>(sql: string, params: unknown[] = []) => asService((c) => rpc<T>(c, sql, params));
let writer: string;
let sender: string;
let n = 0;
const nomes = ["Aurora", "Lumière", "Jasmim", "Safira", "Opala", "Rubi", "Esmeralda"];

async function lead() {
  const i = n++;
  const r = await register(writer, candidate({ diagnosis, business_name: `${nomes[i]} Estética`, phone: `(17) 9${8000 + i}-${1000 + i}`, instagram: `@estilo.${i}` }));
  return r.lead_id as string;
}
const save = (leadId: string) => svc<any>(`select public.api_outreach_save($1, $2, $3::jsonb)`, [writer, leadId, JSON.stringify(msg)]);
const next = () => svc<any>(`select public.api_outreach_next($1)`, [sender]);
const result = (id: string, step: string) => svc<any>(`select public.api_outreach_result($1, $2, $3, true, null)`, [sender, id, step]);
const styles = (s: string) => asAdmin((c) => c.query(`select public.admin_outreach_styles($1)`, [s]));
const pending = () => svc<any>(`select public.api_outreach_reading_pending($1, 5)`, [writer]);
const write = (id: string, text: string) => svc<any>(`select public.api_outreach_reading_save($1, $2, $3)`, [writer, id, text]);
const phoneOf = async (leadId: string) => (await pool.query(`select phone_e164 from leads where id = $1`, [leadId])).rows[0].phone_e164;
const human = async (leadId: string, body: string) => {
  await pool.query(`update outreach_messages set greeting_sent_at = least(greeting_sent_at, now() - interval '1 minute') where greeting_sent_at is not null`);
  await svc(`select public.api_outreach_reply($1, $2::jsonb)`, [
    sender,
    JSON.stringify({ phone_e164: await phoneOf(leadId), body, kind: "humana", reason: "teste", opt_out: false, asks_price: false }),
  ]);
  await pool.query(`update outreach_messages set body_due_at = now() - interval '1 second' where lead_id = $1`, [leadId]);
};
/** Manda a saudação de todos os leads da fila. */
async function greetAll() {
  for (;;) {
    await pool.query(`update outreach_settings set next_send_at = null`);
    const r = await next();
    if (r.etapa !== "saudacao") return;
    await result(r.id, "saudacao");
  }
}

describe("estilos da mensagem", () => {
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

  it("padrão: todos com agradecimento", async () => {
    expect((await save(await lead())).estilo).toBe("agradecimento");
    expect((await save(await lead())).estilo).toBe("agradecimento");
  });

  it("alternar: um lead com agradecimento, o próximo lendo a resposta", async () => {
    expect((await save(await lead())).estilo).toBe("agradecimento");
    await styles("alternar");
    expect((await save(await lead())).estilo).toBe("lendo_resposta");
    expect((await save(await lead())).estilo).toBe("agradecimento");
    expect((await save(await lead())).estilo).toBe("lendo_resposta");
    await styles("agradecimento");
    expect((await save(await lead())).estilo).toBe("agradecimento");
  });

  it("lendo a resposta: o texto só sai depois que o Hermes lê e escreve; o agradecimento não espera", async () => {
    await styles("alternar");
    const a = await lead();
    const b = await lead();
    await save(a);
    await save(b);
    const st = (await pool.query(`select lead_id, style from outreach_messages`)).rows;
    const reading = st.find((r) => r.style === "lendo_resposta")!.lead_id as string;
    const thanks = st.find((r) => r.style === "agradecimento")!.lead_id as string;
    await greetAll();
    expect((await pending()).mensagens).toEqual([]);

    await human(reading, "Olá, bom dia! Como posso ajudar?");
    await human(thanks, "Oi, pode falar");
    const p = (await pending()).mensagens;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ lead_id: reading, respostas: [{ texto: "Olá, bom dia! Como posso ajudar?" }], elogio: msg.elogio });
    expect(p[0].lead.business_name).toMatch(/Estética/);

    // Só o agradecimento sai; o "lendo a resposta" espera o texto.
    const r1 = await next();
    expect(r1).toMatchObject({ etapa: "mensagem", texto: msg.mensagem });
    await result(r1.id, "mensagem");
    expect((await next()).etapa).toBeUndefined();

    const texto = "Bom dia! Me chamo Marcos, tudo bem? Vi as 17 avaliações de vocês no Google. Como as clientes novas costumam chegar até vocês?";
    expect((await write(p[0].message_id, texto)).status).toBe("gravada");
    expect((await write(p[0].message_id, texto)).status).toBe("desatualizada");
    expect((await pending()).mensagens).toEqual([]);
    const r2 = await next();
    expect(r2).toMatchObject({ etapa: "mensagem", texto });
    const row = (await pool.query(`select body, template_body from outreach_messages where id = $1`, [p[0].message_id])).rows[0];
    expect(row).toEqual({ body: texto, template_body: msg.mensagem });
  });

  it("só admin troca o estilo, e só para os dois valores", async () => {
    await expect(as("authenticated", OUTSIDER_ID, (c) => c.query(`select public.admin_outreach_styles('alternar')`))).rejects.toThrow();
    await expect(styles("outro")).rejects.toThrow();
    await expect(asService((c) => c.query(`select public.admin_outreach_styles('alternar')`))).rejects.toThrow();
  });
});
