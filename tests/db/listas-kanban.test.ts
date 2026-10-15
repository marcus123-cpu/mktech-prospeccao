import { beforeEach, describe, expect, it } from "vitest";
import { as, asAdmin, asService, candidate, createToken, OUTSIDER_ID, pool, register, resetData, rpc, tokenId } from "./helpers";

// Listas de prospecção, funil Kanban, campanhas a partir de listas e dashboard.
let tk: string;
let n = 0;
const NOMES = ["Corpo Forte", "Vida Ativa", "Pulso Fit", "Energia Total", "Iron Box", "Movimento Livre", "Alto Rendimento", "Saúde em Foco", "Barber King", "Navalha Fina"];
const diagnosis = (fit: number) => ({ fit_score: fit, confidence: "media", summary: "Negócio ativo sem site.", digital_presence: "Instagram ativo.", pains: [{ pain: "Sem site", evidence: "Bio sem link" }], opportunities: ["Landing page"], offer: "landing_page", offer_reason: "Sem presença própria." });
async function mk(over: Record<string, unknown> = {}, fit = 50): Promise<string> {
  const i = n++;
  const r = await register(tk, candidate({ business_name: `${NOMES[i % NOMES.length]} ${i}`, phone: `(17) 9${6000 + i}-${3000 + i}`, instagram: `@lead.${i}`, diagnosis: diagnosis(fit), ...over }));
  expect(r.status).toBe("criado");
  return r.lead_id;
}
const adm = (sql: string, args: unknown[] = []) => asAdmin((c) => rpc<any>(c, sql, args));
const q = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows;
const stage = async (lead: string) => (await q(`select stage from prospect_kanban where lead_id = $1`, [lead]))[0].stage;
const newList = (name = "Academias SP") => adm(`select admin_list_create($1)`, [name]);

describe("listas de prospecção", () => {
  beforeEach(async () => {
    await resetData();
    n = 0;
    tk = (await tokenId((await createToken()).token))!;
  });

  it("cria, renomeia e exclui; nome repetido é recusado", async () => {
    const a = await newList("A");
    await expect(newList("a")).rejects.toThrow(/Já existe/);
    await adm(`select admin_list_rename($1, $2)`, [a, "Barbearias"]);
    expect((await q(`select name from lead_lists`))[0].name).toBe("Barbearias");
    const l = await mk();
    await adm(`select admin_list_add($1, $2::uuid[])`, [a, [l]]);
    await adm(`select admin_list_delete($1)`, [a]);
    expect((await q(`select count(*)::int n from lead_list_items`))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from leads`))[0].n).toBe(1);
  });

  it("adiciona individualmente e em massa sem duplicar; nota baixa não bloqueia", async () => {
    const list = await newList();
    const baixo = await mk({}, 5);
    const outro = await mk({}, 90);
    expect(await adm(`select admin_list_add($1, $2::uuid[])`, [list, [baixo]])).toEqual({ added: 1, duplicates: 0 });
    expect(await adm(`select admin_list_add($1, $2::uuid[])`, [list, [baixo, outro, outro]])).toEqual({ added: 1, duplicates: 1 });
    expect((await q(`select count(*)::int n from lead_list_items`))[0].n).toBe(2);
  });

  it("filtra por nicho, cidade, estado e nota e seleciona todos os resultados filtrados", async () => {
    for (let i = 0; i < 4; i++) await mk({ niche: "Academia", city: "Bauru", state: "SP" }, 20 + i * 10);
    for (let i = 0; i < 3; i++) await mk({ niche: "Barbearia", city: "Marília", state: "SP" }, 80);
    await mk({ niche: "Academia", city: "Curitiba", state: "PR" }, 95);
    const list = await newList();
    expect(await adm(`select admin_filter_count($1::jsonb)`, [JSON.stringify({ niche: "academia" })])).toBe(5);
    expect(await adm(`select admin_filter_count($1::jsonb)`, [JSON.stringify({ state: "sp" })])).toBe(7);
    expect(await adm(`select admin_filter_count($1::jsonb)`, [JSON.stringify({ city: "mar" })])).toBe(3);
    expect(await adm(`select admin_filter_count($1::jsonb)`, [JSON.stringify({ min_score: 30, max_score: 50 })])).toBe(3);
    const r = await adm(`select admin_list_add_filtered($1, $2::jsonb)`, [list, JSON.stringify({ niche: "Academia", state: "SP" })]);
    expect(r).toEqual({ added: 4, duplicates: 0 });
    expect(await adm(`select admin_list_add_filtered($1, $2::jsonb)`, [list, JSON.stringify({ state: "SP" })])).toEqual({ added: 3, duplicates: 4 });
    expect(await adm(`select admin_filter_count($1::jsonb)`, [JSON.stringify({ not_in_list: list })])).toBe(1);
  });

  it("remove e move entre listas sem duplicar", async () => {
    const a = await newList("A"), b = await newList("B");
    const x = await mk(), y = await mk();
    await adm(`select admin_list_add($1, $2::uuid[])`, [a, [x, y]]);
    await adm(`select admin_list_add($1, $2::uuid[])`, [b, [y]]);
    expect(await adm(`select admin_list_move($1, $2, $3::uuid[])`, [a, b, [x, y]])).toEqual({ moved: 1 });
    expect((await q(`select list_id, count(*)::int n from lead_list_items group by 1`)).length).toBe(1);
    expect(await adm(`select admin_list_remove($1, $2::uuid[])`, [b, [x]])).toBe(1);
    expect((await q(`select count(*)::int n from lead_list_items`))[0].n).toBe(1);
  });

  it("só o administrador mexe nas listas", async () => {
    await expect(as("authenticated", OUTSIDER_ID, (c) => c.query(`select admin_list_create('x')`))).rejects.toThrow();
    await expect(asService((c) => c.query(`select admin_list_create('x')`))).rejects.toThrow();
  });
});

describe("funil Kanban", () => {
  beforeEach(async () => {
    await resetData();
    n = 0;
    tk = (await tokenId((await createToken()).token))!;
  });
  const move = (lead: string, to: string, note: string | null = null, value: number | null = null, at: string | null = null) =>
    adm(`select admin_kanban_move($1, $2, $3, $4, $5)`, [lead, to, note, value, at]);

  it("lead novo entra em Novo e vai para Na lista ao entrar numa lista", async () => {
    const l = await mk();
    expect(await stage(l)).toBe("novo");
    await adm(`select admin_list_add($1, $2::uuid[])`, [await newList(), [l]]);
    expect(await stage(l)).toBe("na_lista");
  });

  it("movimento manual atualiza a etapa e registra histórico", async () => {
    const l = await mk();
    await move(l, "contatado", "liguei");
    expect(await stage(l)).toBe("contatado");
    expect((await q(`select stage from leads where id = $1`, [l]))[0].stage).toBe("contatado");
    await move(l, "negociacao");
    expect(await stage(l)).toBe("negociacao");
    await move(l, "aguardando_resposta");
    expect(await stage(l)).toBe("aguardando_resposta");
    const ev = await q(`select from_stage, to_stage from lead_kanban_events where lead_id = $1 order by id`, [l]);
    expect(ev.map((e) => e.to_stage)).toEqual(["contatado", "negociacao", "aguardando_resposta"]);
  });

  it("a conversa real manda: resposta humana leva a Respondeu, mesmo depois de um movimento manual", async () => {
    const l = await mk();
    await move(l, "contatado");
    await q(`insert into outreach_replies(lead_id, phone_e164, body, received_at, kind) select id, phone_e164, 'Oi, tudo bem?', now() + interval '1 second', 'humana' from leads where id = $1`, [l]);
    expect(await stage(l)).toBe("respondeu");
    // Resposta simulada nunca move o funil.
    const m = await mk();
    await q(`insert into outreach_replies(lead_id, phone_e164, body, received_at, kind, simulated) select id, phone_e164, 'teste', now(), 'humana', true from leads where id = $1`, [m]);
    expect(await stage(m)).toBe("novo");
  });

  it("envio real leva a Aguardando resposta; envio simulado não conta", async () => {
    const l = await mk(), m = await mk();
    await q(`insert into commercial_outbox(lead_id, idempotency_key, kind, body, phone_e164, status, sent_at) select id, 'k1', 'initial', 'Olá', phone_e164, 'enviada', now() from leads where id = $1`, [l]);
    await q(`insert into commercial_outbox(lead_id, idempotency_key, kind, body, phone_e164, status, sent_at, simulated) select id, 'k2', 'initial', 'Olá', phone_e164, 'simulada', now(), true from leads where id = $1`, [m]);
    expect(await stage(l)).toBe("aguardando_resposta");
    expect(await stage(m)).toBe("novo");
  });

  it("não fecha venda sem valor e data confirmados; perdido exige motivo", async () => {
    const l = await mk();
    await expect(move(l, "fechado")).rejects.toThrow(/valor e data/);
    expect(await stage(l)).toBe("novo");
    await move(l, "fechado", "Pix recebido", 1500, new Date().toISOString());
    expect(await stage(l)).toBe("fechado");
    expect((await q(`select closed_value from leads where id = $1`, [l]))[0].closed_value).toBe("1500.00");
    const p = await mk();
    await expect(move(p, "perdido")).rejects.toThrow(/motivo/);
    await move(p, "perdido", "Já contratou outra agência");
    expect(await stage(p)).toBe("perdido");
  });

  it("não contatar bloqueia o lead, cancela a fila e não pode ser desfeito pelo funil", async () => {
    const l = await mk();
    await q(`insert into commercial_outbox(lead_id, idempotency_key, kind, body, phone_e164) select id, 'k3', 'initial', 'Olá', phone_e164 from leads where id = $1`, [l]);
    await move(l, "nao_contatar", "pediu para parar");
    expect(await stage(l)).toBe("nao_contatar");
    expect((await q(`select do_not_contact from leads where id = $1`, [l]))[0].do_not_contact).toBe(true);
    expect((await q(`select status from commercial_outbox where lead_id = $1`, [l]))[0].status).toBe("cancelada");
    await expect(move(l, "novo")).rejects.toThrow(/não contatar/);
    await expect(move(l, "interessado")).rejects.toThrow(/não contatar/);
  });

  it("Na lista exige lista; Novo não vale para lead já contatado", async () => {
    const l = await mk();
    await expect(move(l, "na_lista")).rejects.toThrow(/lista/);
    await move(l, "contatado");
    await expect(move(l, "novo")).rejects.toThrow(/contatado/);
    await expect(move(l, "inexistente")).rejects.toThrow(/inválida/);
  });
});

describe("campanhas a partir de listas e dashboard", () => {
  let lead: string;
  beforeEach(async () => {
    await resetData();
    n = 0;
    tk = (await tokenId((await createToken()).token))!;
    await q(`update commercial_settings set enabled = true, channel_authorized = true, engine_version = 'v6', test_mode = false`);
  });
  const ready = (id: string) => adm(`select admin_commercial_lead($1, $2::jsonb)`, [id, JSON.stringify({ eligible: true, eligibility_reason: "pesquisa completa" })]);

  it("monta campanha por lista, por elegíveis, sem duplicar, e conta destinatários", async () => {
    const a = await mk(), b = await mk(), c = await mk();
    for (const id of [a, b, c]) await ready(id);
    const weak = await mk(); // não elegível: pesquisa insuficiente
    const list = await newList();
    await adm(`select admin_list_add($1, $2::uuid[])`, [list, [a, b, weak]]);
    const camp = await adm(`select admin_campaign_create($1, null)`, ["Teste"]);
    const r = await adm(`select admin_campaign_add_list($1, $2)`, [camp, list]);
    expect(r).toMatchObject({ added: 2, rejected_total: 1 });
    expect((await q(`select source_list_id from commercial_campaigns`))[0].source_list_id).toBe(list);
    const all = await adm(`select admin_campaign_add_eligible($1)`, [camp]);
    expect(all.added).toBe(1); // só o "c": a e b já estão; weak segue recusado
    expect((await adm(`select admin_campaign_stats($1)`, [camp])).recipients).toBe(3);
    const other = await adm(`select admin_campaign_create($1, null)`, ["Outra"]);
    expect((await adm(`select admin_campaign_add_leads($1, $2::uuid[])`, [other, [a]])).rejected[0].reason).toMatch(/já pertence/);
  });

  it("estatísticas separam preparadas, enviadas, entregues, simuladas, respostas, falhas e bloqueios", async () => {
    lead = await mk(); await ready(lead);
    const camp = await adm(`select admin_campaign_create($1, null)`, ["Stats"]);
    await adm(`select admin_campaign_add_leads($1, $2::uuid[])`, [camp, [lead]]);
    const ob = (k: string, status: string, sim = false) => q(`insert into commercial_outbox(lead_id, idempotency_key, kind, body, phone_e164, status, simulated, sent_at) select id, $2, 'reply', 'x', phone_e164, $3, $4, case when $3 in ('enviada','entregue','simulada') then now() end from leads where id = $1`, [lead, k, status, sim]);
    await ob("a", "enfileirada"); await ob("b", "enviada"); await ob("c", "entregue"); await ob("d", "falhou"); await ob("e", "simulada", true);
    await q(`insert into outreach_replies(lead_id, phone_e164, body, received_at, kind) select id, phone_e164, 'oi', now(), 'humana' from leads where id = $1`, [lead]);
    expect(await adm(`select admin_campaign_stats($1)`, [camp])).toMatchObject({ recipients: 1, prepared: 1, sent: 2, delivered: 1, simulated: 1, failures: 1, replies: 1, blocked: 0 });
    await q(`update leads set do_not_contact = true where id = $1`, [lead]);
    expect((await adm(`select admin_campaign_stats($1)`, [camp])).blocked).toBe(1);
  });

  it("dashboard: preparadas não são enviadas e simuladas não entram", async () => {
    lead = await mk(); await ready(lead);
    await q(`insert into commercial_outbox(lead_id, idempotency_key, kind, body, phone_e164, status) select id, 'p1', 'initial', 'x', phone_e164, 'enfileirada' from leads where id = $1`, [lead]);
    await q(`insert into commercial_outbox(lead_id, idempotency_key, kind, body, phone_e164, status, simulated, sent_at) select id, 's1', 'reply', 'x', phone_e164, 'simulada', true, now() from leads where id = $1`, [lead]);
    const list = await newList();
    await adm(`select admin_list_add($1, $2::uuid[])`, [list, [lead]]);
    const d = await adm(`select admin_prospecting_dashboard()`);
    expect(d).toMatchObject({ prepared: 1, sent: 0, delivered: 0, in_lists: 1, active_campaigns: 0, with_contact: 0, replies: 0 });
    expect(d.kanban).toMatchObject({ na_lista: 1 });
  });
});
