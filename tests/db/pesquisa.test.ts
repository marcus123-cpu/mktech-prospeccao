import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asService, candidate, createToken, pool, register, resetData, rpc, tokenId } from "./helpers";

// Pesquisa configurável: nicho livre, localização, meta, candidatos incompletos e relatório.
let tk: string;
let n = 0;
const ask = (q: number, niche = "Academia", scope = "brasil", state: string | null = null, city: string | null = null) =>
  asAdmin((c) => rpc<string>(c, `select public.admin_search_request_v2($1, $2, $3, $4, $5)`, [q, niche, scope, state, city]));
const request = async (id: string) => (await pool.query(`select * from hermes_requests where id = $1`, [id])).rows[0];
const start = () => asService((c) => rpc<any>(c, `select public.api_start_run($1, 'pedido-painel', '{}'::jsonb)`, [tk]));
const peek = () => asService((c) => rpc<any>(c, `select public.api_search_request_peek($1)`, [tk]));
const finish = (run: string, extra: object = {}) =>
  asService((c) => rpc<any>(c, `select public.api_finish_run($1, $2, $3::jsonb)`, [tk, run, JSON.stringify({ status: "parcial", end_reason: "fontes esgotadas", searched: 111, discarded: 3, ...extra })]));
const NOMES = ["Corpo Forte", "Vida Ativa", "Pulso Fit", "Energia Total", "Iron Box", "Movimento Livre", "Alto Rendimento", "Saúde em Foco"];
const lead = (over: Record<string, unknown> = {}) => {
  const i = n++;
  return candidate({ business_name: `${NOMES[i % NOMES.length]} ${i}`, phone: `(17) 9${7000 + i}-${2000 + i}`, instagram: `@academia.teste${i}`, ...over });
};
const report = (run: string) => asService((c) => rpc<any>(c, `select public.hermes_run_report($1)`, [run]));

describe("pesquisa configurável", () => {
  beforeEach(async () => {
    await resetData();
    n = 0;
    tk = (await tokenId((await createToken()).token))!;
  });

  it("Brasil inteiro ignora estado e cidade; nicho é texto livre e obrigatório", async () => {
    const id = await ask(100, "Oficina Mecânica", "brasil", "SP", "Bauru");
    expect(await request(id)).toMatchObject({ niche: "Oficina Mecânica", location_scope: "brasil", location_state: null, location_city: null, qualified_target: 100 });
    await pool.query(`update hermes_requests set status = 'cancelado'`);
    await expect(ask(10, "")).rejects.toThrow(/nicho/);
    await expect(ask(10, "x")).rejects.toThrow(/nicho/);
  });

  it("estado exige UF válida e cidade exige cidade e estado", async () => {
    await expect(ask(10, "Barbearia", "estado")).rejects.toThrow(/estado/);
    await expect(ask(10, "Barbearia", "estado", "XX")).rejects.toThrow(/estado/);
    await expect(ask(10, "Barbearia", "cidade", "SP")).rejects.toThrow(/cidade e estado/);
    await expect(ask(10, "Barbearia", "cidade", null, "Bauru")).rejects.toThrow(/cidade e estado/);
    await expect(ask(10, "Barbearia", "outro")).rejects.toThrow(/localização/);
    const e = await ask(10, "Barbearia", "estado", "mg", "Ignorada");
    expect(await request(e)).toMatchObject({ location_scope: "estado", location_state: "MG", location_city: null });
    await pool.query(`update hermes_requests set status = 'cancelado'`);
    const c = await ask(10, "Barbearia", "cidade", "SP", "Bauru");
    expect(await request(c)).toMatchObject({ location_scope: "cidade", location_state: "SP", location_city: "Bauru" });
  });

  it("quantidade: qualquer inteiro de 1 a 1000", async () => {
    for (const bad of [0, -5, 1001]) await expect(ask(bad)).rejects.toThrow(/quantidade/);
    for (const q of [1, 10, 50, 200, 500, 1000]) {
      const id = await ask(q);
      expect((await request(id)).qualified_target).toBe(q);
      await pool.query(`update hermes_requests set status = 'cancelado'`);
    }
    expect((await request(await ask(1000))).max_searches).toBeLessThanOrEqual(5000);
  });

  it("peek e start-run entregam nicho e localização do próprio pedido, inclusive ao retomar", async () => {
    const id = await ask(20, "Escola de Idiomas", "cidade", "SP", "Bauru");
    expect(await peek()).toMatchObject({ status: "pendente", niche: "Escola de Idiomas", location_scope: "cidade", location_state: "SP", location_city: "Bauru" });
    const r = await start();
    expect(r).toMatchObject({ status: "iniciada", niche: "Escola de Idiomas", location_scope: "cidade", location_city: "Bauru" });
    await pool.query(`update hermes_runs set started_at = now() - interval '40 minutes' where id = $1`, [r.run_id]);
    await pool.query(`update lead_evidences set created_at = now() - interval '20 minutes' where run_id = $1`, [r.run_id]);
    // Uma nova pesquisa não pode alterar a localização da que está em andamento.
    await expect(ask(5, "Academia", "brasil")).rejects.toThrow(/aberto/);
    expect(await peek()).toMatchObject({ status: "retomar", pedido_id: id, niche: "Escola de Idiomas", location_state: "SP" });
    expect(await start()).toMatchObject({ status: "retomada", run_id: r.run_id, niche: "Escola de Idiomas", location_city: "Bauru" });
  });

  it("candidato incompleto é salvo: sem WhatsApp, nota baixa, telefone fixo, verificação pendente", async () => {
    await ask(3);
    const r = await start();
    const fixo = await register(tk, lead({ phone: "(14) 3222-1000", instagram: undefined, site_status: "verificacao_pendente" }), undefined, r.run_id);
    expect(fixo.status).toBe("criado");
    const semContato = await register(tk, lead({ phone: undefined, instagram: undefined, address: "Rua das Flores 10, Centro" }), undefined, r.run_id);
    expect(semContato.status).toBe("criado");
    const nada = await register(tk, lead({ phone: undefined, instagram: undefined }), undefined, r.run_id);
    expect(nada.status).toBe("invalido");
    expect((await pool.query(`select phone_e164 from leads where id = $1`, [fixo.lead_id])).rows[0].phone_e164).toBe("+551432221000");
    expect((await report(r.run_id)).saved).toBe(2);
  });

  it("a meta é um alvo: entrega o que achou e o relatório explica a diferença e os descartes", async () => {
    await ask(100, "Academia", "estado", "SP");
    const r = await start();
    for (let i = 0; i < 3; i++) expect((await register(tk, lead(), undefined, r.run_id)).status).toBe("criado");
    await pool.query(`insert into hermes_run_discards(run_id, business_name, reason_code, reason) values ($1, 'A', 'ja_possui_site', 'Já possui site próprio sem lacuna comprovada de visibilidade'), ($1, 'B', 'ja_possui_site', 'Já possui site próprio sem lacuna comprovada de visibilidade')`, [r.run_id]);
    const f = await finish(r.run_id, { discard_reasons: { "fora do nicho": 4, "negócio encerrado": 1 } });
    expect(f.status).toBe("encerrada");
    const rep = await report(r.run_id);
    expect(rep).toMatchObject({ niche: "Academia", location_scope: "estado", location_state: "SP", target: 100, analyzed: 111, saved: 3 });
    expect(rep.discard_reasons).toEqual(expect.arrayContaining([
      { reason: "Já possui site próprio sem lacuna comprovada de visibilidade", count: 2 }, { reason: "fora do nicho", count: 4 }, { reason: "negócio encerrado", count: 1 }]));
    expect(rep.shortfall).toMatchObject({ missing: 97, reason: "fontes esgotadas" });
    expect(await asAdmin((c) => rpc<any>(c, `select public.admin_run_report($1)`, [r.run_id]))).toMatchObject({ saved: 3 });
  });

  it("duplicado vira atualização, não novo lead", async () => {
    await ask(10);
    const r = await start();
    const first = lead();
    expect((await register(tk, first, undefined, r.run_id)).status).toBe("criado");
    expect((await register(tk, first, undefined, r.run_id)).status).toBe("existente");
    const rep = await report(r.run_id);
    expect(rep).toMatchObject({ saved: 1, updated: 1 });
  });
});
