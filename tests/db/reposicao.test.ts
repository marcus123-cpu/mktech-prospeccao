import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asService, candidate, count, createToken, pool, register, resetData, rpc, tokenId } from "./helpers";

const diagnosis = (fit: number) => ({
  fit_score: fit,
  confidence: "media",
  summary: "Clínica de estética facial ativa, agenda só pelo WhatsApp.",
  digital_presence: "Instagram ativo, sem site.",
  pains: [{ pain: "Agenda manual pelo WhatsApp", evidence: "Bio: 'agende pelo direct'" }],
  opportunities: ["Página com agendamento online"],
  offer: "site_com_agendamento",
  offer_reason: "Muitas mensagens para marcar horário.",
});

let tk: string;
let n = 0;
const nomes = ["Aurora", "Lumière", "Jasmim", "Safira", "Opala", "Rubi", "Esmeralda", "Topázio", "Ágata", "Cristal", "Pérola", "Ônix"];
const novo = (over: Record<string, unknown> = {}, fit = 80) => {
  const i = n++;
  return register(
    tk,
    candidate({ business_name: `${nomes[i % nomes.length]} ${i}`, phone: `(17) 9${8000 + i}-${1000 + i}`, instagram: `@reposicao.${i}`, diagnosis: diagnosis(fit), ...over }),
  );
};
const stock = () => asAdmin((c) => rpc<number>(c, `select public.prospecting_stock()`));
const start = () => asService((c) => rpc<any>(c, `select public.api_start_run($1, 'prospeccao-diaria', '{}'::jsonb)`, [tk]));
const apiSettings = () => asService((c) => rpc<any>(c, `select public.api_get_settings($1)`, [tk]));

describe("reposição do estoque de leads", () => {
  beforeEach(async () => {
    await resetData();
    n = 0;
    tk = (await tokenId((await createToken()).token))!;
    await pool.query(`update prospecting_settings set restock_enabled = true`);
  });

  it("conta só leads prontos: novo, com WhatsApp, nota 60+, diagnóstico, sem mensagem ativa", async () => {
    await novo();
    await novo({}, 59);
    await novo({ phone: undefined });
    const parar = (await novo()).lead_id;
    const comMsg = (await novo()).lead_id;
    await pool.query(`update leads set do_not_contact = true where id = $1`, [parar]);
    await pool.query(
      `insert into outreach_messages (lead_id, phone_e164, status, body, compliment, pain, improvement)
       select id, phone_e164, 'pronta', 'x', 'x', 'x', 'x' from leads where id = $1`,
      [comMsg],
    );
    expect(await stock()).toBe(2);
  });

  it("mensagem na fila ainda conta; saudação enviada sai da conta", async () => {
    const a = (await novo()).lead_id;
    const b = (await novo()).lead_id;
    for (const [id, st] of [[a, "pronta"], [b, "saudacao_enviada"]] as const) {
      await pool.query(
        `insert into outreach_messages (lead_id, phone_e164, status, body, compliment, pain, improvement)
         select id, phone_e164, $2, 'x', 'x', 'x', 'x' from leads where id = $1`,
        [id, st],
      );
    }
    expect(await stock()).toBe(1);
  });

  it("10 prontos: a reposição busca 10 para voltar a 20", async () => {
    for (let i = 0; i < 10; i++) await novo();
    expect(await stock()).toBe(10);
    expect((await apiSettings()).run_target).toBe(10);
    expect(await start()).toMatchObject({ restock: true, run_target: 10, stock_ready: 10 });
  });

  it("estoque abaixo de 20: o servidor abre a execução buscando só a diferença até 20", async () => {
    await novo();
    const s = await apiSettings();
    expect(s.restock_needed).toBe(true);
    expect(s.run_target).toBe(19);
    expect(s.stock_ready).toBe(1);
    const r = await start();
    expect(r).toMatchObject({ status: "iniciada", restock: true, run_target: 19, stock_ready: 1 });
    expect((await pool.query(`select restock_target from hermes_runs where id = $1`, [r.run_id])).rows[0].restock_target).toBe(19);
  });

  it("estoque com 20 ou mais: execução normal, meta diária", async () => {
    await pool.query(`update prospecting_settings set restock_min = 2, daily_target = 5`);
    await novo();
    await novo();
    const r = await start();
    expect(r).toMatchObject({ restock: false, run_target: 5 });
    expect((await pool.query(`select restock_target from hermes_runs where id = $1`, [r.run_id])).rows[0].restock_target).toBeNull();
  });

  it("reposição desligada volta ao comportamento antigo", async () => {
    await pool.query(`update prospecting_settings set restock_enabled = false, daily_target = 7`);
    const r = await start();
    expect(r).toMatchObject({ restock: false, run_target: 7 });
  });

  it("na reposição o servidor passa da meta diária, mas para em restock_batch por execução", async () => {
    await pool.query(`update prospecting_settings set daily_target = 1, restock_batch = 3`);
    const r = await start();
    const res = [];
    for (let i = 0; i < 4; i++) {
      const j = 10 + i;
      res.push(
        (
          await register(
            tk,
            candidate({ business_name: nomes[j % nomes.length], phone: `(17) 9${8100 + j}-${1100 + j}`, instagram: `@teste.unico.r${j}`, diagnosis: diagnosis(80) }),
            undefined,
            r.run_id,
          )
        ).status,
      );
    }
    expect(res).toEqual(["criado", "criado", "criado", "limite_atingido"]);
  });

  it("teto diário: 3 reposições de lote", async () => {
    await pool.query(`update prospecting_settings set daily_target = 1, restock_batch = 1`);
    const statuses: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await start();
      const j = 20 + i;
      statuses.push(
        (
          await register(
            tk,
            candidate({ business_name: nomes[j % nomes.length], phone: `(17) 9${8200 + j}-${1200 + j}`, instagram: `@teste.unico.t${j}`, diagnosis: diagnosis(80) }),
            undefined,
            r.run_id,
          )
        ).status,
      );
      await asService((c) => c.query(`select public.api_finish_run($1, $2, '{"status":"concluida","end_reason":"teste"}'::jsonb)`, [tk, r.run_id]));
    }
    expect(statuses).toEqual(["criado", "criado", "criado", "limite_atingido"]);
    expect(await count("leads")).toBe(3);
  });
});
