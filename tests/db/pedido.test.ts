import { beforeEach, describe, expect, it } from "vitest";
import { as, asAdmin, asService, candidate, count, createToken, OUTSIDER_ID, pool, register, resetData, rpc, tokenId } from "./helpers";

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
const cand = (fit = 80, over: Record<string, unknown> = {}) => {
  const i = n++;
  return candidate({
    business_name: `${nomes[i % nomes.length]} ${i}`,
    phone: `(17) 9${8000 + i}-${1000 + i}`,
    instagram: `@pedido.${i}`,
    diagnosis: diagnosis(fit),
    ...over,
  });
};
const ask = (q: number) => asAdmin((c) => rpc<string>(c, `select public.admin_search_request($1)`, [q]));
const peek = () => asService((c) => rpc<any>(c, `select public.api_search_request_peek($1)`, [tk]));
const start = (routine = "pedido-painel") =>
  asService((c) => rpc<any>(c, `select public.api_start_run($1, $2, '{}'::jsonb)`, [tk, routine]));
const finish = (run: string) =>
  asService((c) => rpc<any>(c, `select public.api_finish_run($1, $2, $3::jsonb)`, [tk, run, JSON.stringify({ status: "concluida", end_reason: "meta do pedido" })]));
const request = async (id: string) => (await pool.query(`select * from hermes_requests where id = $1`, [id])).rows[0];

describe("pedido de busca pelo painel", () => {
  beforeEach(async () => {
    await resetData();
    n = 0;
    tk = (await tokenId((await createToken()).token))!;
  });

  it("o painel pede N qualificados; o limite de buscas sai sozinho (15 por lead, de 150 a 500)", async () => {
    const id = await ask(30);
    expect(await request(id)).toMatchObject({ qualified_target: 30, max_searches: 450, status: "pendente" });
    await asAdmin((c) => c.query(`select public.admin_search_request_cancel($1)`, [id]));
    expect((await request(await ask(5))).max_searches).toBe(150);
    await pool.query(`update hermes_requests set status = 'cancelado'`);
    expect((await request(await ask(100))).max_searches).toBe(500);
  });

  it("só um pedido aberto por vez, e só admin pede", async () => {
    await ask(10);
    await expect(ask(10)).rejects.toThrow(/pedido de busca aberto/);
    await expect(as("authenticated", OUTSIDER_ID, (c) => c.query(`select public.admin_search_request(5)`))).rejects.toThrow();
    await expect(ask(0)).rejects.toThrow();
  });

  it("sem pedido o PC não chama o Hermes; com pedido a execução pega a meta do pedido", async () => {
    expect(await peek()).toEqual({ status: "nenhum" });
    expect(await start()).toMatchObject({ status: "sem_pedido" });
    const id = await ask(3);
    expect(await peek()).toMatchObject({ status: "pendente", qualificados: 3, max_buscas: 150 });
    const r = await start();
    expect(r).toMatchObject({ status: "iniciada", pedido: true, run_target: 3, max_searches: 150 });
    expect(await request(id)).toMatchObject({ status: "em_andamento", run_id: r.run_id });
    expect(await peek()).toEqual({ status: "nenhum" });
    expect(await start()).toMatchObject({ status: "ja_em_andamento" });
  });

  it("para ao bater a meta de qualificados; não qualificado não conta; não usa a meta diária", async () => {
    await pool.query(`update prospecting_settings set daily_target = 1`);
    const id = await ask(2);
    const r = await start();
    expect((await register(tk, cand(40), undefined, r.run_id)).status).toBe("criado");
    expect((await register(tk, cand(80, { phone: undefined, instagram: "@sem.zap" }), undefined, r.run_id)).status).toBe("criado");
    expect((await register(tk, cand(85), undefined, r.run_id)).status).toBe("criado");
    expect((await register(tk, cand(90), undefined, r.run_id)).status).toBe("criado");
    expect((await register(tk, cand(95), undefined, r.run_id)).status).toBe("limite_atingido");
    const f = await finish(r.run_id);
    expect(f.qualificados).toBe(2);
    expect(await request(id)).toMatchObject({ status: "concluido", qualified_found: 2 });
    expect(await count("leads")).toBe(4);
  });

  it("execução de pedido abandonada fecha o pedido", async () => {
    const id = await ask(5);
    const r = await start();
    await pool.query(`update hermes_runs set started_at = now() - interval '6 hours' where id = $1`, [r.run_id]);
    await ask(5).catch(() => null);
    expect(await start()).toMatchObject({ status: "sem_pedido" });
    expect(await request(id)).toMatchObject({ status: "concluido", qualified_found: 0 });
  });

  it("execução parada há 15 minutos é retomada: mesma execução, contando o que já veio", async () => {
    const id = await ask(3);
    const r = await start();
    expect((await register(tk, cand(85), undefined, r.run_id)).status).toBe("criado");
    // Cadastrou há pouco: ainda está trabalhando, nada de retomar.
    await pool.query(`update hermes_runs set started_at = now() - interval '40 minutes' where id = $1`, [r.run_id]);
    expect(await peek()).toEqual({ status: "nenhum" });
    expect(await start()).toMatchObject({ status: "ja_em_andamento" });
    // 20 minutos sem cadastrar nada: o PC chama de novo e a execução continua.
    await pool.query(`update lead_evidences set created_at = now() - interval '20 minutes' where run_id = $1`, [r.run_id]);
    expect(await peek()).toMatchObject({ status: "retomar", pedido_id: id, run_id: r.run_id, qualificados: 3, ja_vieram: 1 });
    expect(await start()).toMatchObject({ status: "retomada", run_id: r.run_id, meta_qualificados: 3, ja_vieram: 1, faltam: 2, retomadas: 1 });
    expect(await peek()).toEqual({ status: "nenhum" });
    expect(await start()).toMatchObject({ status: "ja_em_andamento" });
    expect((await register(tk, cand(90), undefined, r.run_id)).status).toBe("criado");
    expect((await register(tk, cand(90), undefined, r.run_id)).status).toBe("criado");
    expect((await register(tk, cand(90), undefined, r.run_id)).status).toBe("limite_atingido");
    expect((await finish(r.run_id)).qualificados).toBe(3);
    expect(await request(id)).toMatchObject({ status: "concluido", qualified_found: 3 });
  });

  it("depois de 3 retomadas parado, o pedido fecha com o que veio", async () => {
    const id = await ask(5);
    const r = await start();
    for (let i = 1; i <= 3; i++) {
      await pool.query(
        `update hermes_runs set started_at = now() - interval '30 minutes',
           config = config || jsonb_build_object('retomada_at', now() - interval '20 minutes') where id = $1`, [r.run_id]);
      expect(await start()).toMatchObject({ status: "retomada", retomadas: i });
    }
    await pool.query(`update hermes_runs set config = config || jsonb_build_object('retomada_at', now() - interval '20 minutes') where id = $1`, [r.run_id]);
    expect(await peek()).toEqual({ status: "nenhum" });
    expect(await request(id)).toMatchObject({ status: "concluido", qualified_found: 0 });
    expect((await request(id)).note).toMatch(/3 retomadas/);
    expect((await pool.query(`select status from hermes_runs where id = $1`, [r.run_id])).rows[0].status).toBe("abandonada");
  });

  it("a rotina diária continua igual", async () => {
    await ask(5);
    expect(await start("prospeccao-diaria")).toMatchObject({ status: "iniciada", restock: false, run_target: 20 });
  });
});
