import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_ID,
  OUTSIDER_ID,
  as,
  asAdmin,
  asService,
  candidate,
  count,
  createToken,
  pool,
  register,
  resetData,
  rpc,
  sha256,
  tokenId,
} from "./helpers";

let tok: string;
let tokenPlain: string;

beforeEach(async () => {
  await resetData();
  const t = await createToken();
  tokenPlain = t.token;
  tok = (await tokenId(t.token))!;
});

afterAll(async () => {
  await pool.end();
});

const metrics = (start: string, end: string) =>
  asAdmin((c) => rpc(c, `select public.dashboard_metrics($1::date, $2::date)`, [start, end]));

async function newLead(overrides: Record<string, unknown> = {}) {
  const r = await register(tok, candidate(overrides));
  expect(r.status).toBe("criado");
  return r.lead_id as string;
}

describe("contatos, etapas e indicadores", () => {
  it("correção de contato preserva auditoria e sai dos indicadores", async () => {
    const id = await newLead();
    const ev = await asAdmin((c) =>
      rpc(c, `select public.admin_mark_contacted($1, '2026-10-08 14:00-03'::timestamptz)`, [id]),
    );
    let m = await metrics("2026-10-08", "2026-10-08");
    expect(m).toMatchObject({ contact_actions: 1, contacted_leads: 1, first_contacts: 1 });

    await asAdmin((c) => c.query(`select public.admin_correct_contact($1, 'marquei o lead errado')`, [ev]));
    m = await metrics("2026-10-08", "2026-10-08");
    expect(m).toMatchObject({ contact_actions: 0, contacted_leads: 0, first_contacts: 0, response_rate: null });
    const { rows } = await pool.query(`select contacted, stage from leads where id = $1`, [id]);
    expect(rows[0]).toEqual({ contacted: false, stage: "novo" });
    expect(await count("contact_events", "voided_at is not null")).toBe(1);
  });

  it("correção com nova data move o contato de dia", async () => {
    const id = await newLead();
    const ev = await asAdmin((c) =>
      rpc(c, `select public.admin_mark_contacted($1, '2026-10-08 14:00-03'::timestamptz)`, [id]),
    );
    await asAdmin((c) =>
      c.query(`select public.admin_correct_contact($1, 'data errada', '2026-10-06 10:00-03'::timestamptz)`, [ev]),
    );
    expect((await metrics("2026-10-08", "2026-10-08")).contact_actions).toBe(0);
    expect((await metrics("2026-10-06", "2026-10-06")).contact_actions).toBe(1);
  });

  it("diferencia ações de contato de leads contatados e calcula taxas por coorte", async () => {
    const a = await newLead();
    const b = await newLead({ business_name: "Espaço Lumi", phone: "(17) 99888-1111", instagram: "@espaco.lumi" });
    await asAdmin(async (c) => {
      await c.query(`select public.admin_mark_contacted($1, '2026-10-05 09:00-03'::timestamptz)`, [a]);
      await c.query(`select public.admin_mark_contacted($1, '2026-10-06 09:00-03'::timestamptz)`, [a]);
      await c.query(`select public.admin_mark_contacted($1, '2026-10-06 11:00-03'::timestamptz)`, [b]);
      await c.query(`select public.admin_change_stage($1, 'respondeu')`, [a]);
    });
    const m = await metrics("2026-10-05", "2026-10-11");
    expect(m).toMatchObject({ contact_actions: 3, contacted_leads: 2, first_contacts: 2 });
    expect(Number(m.response_rate)).toBe(0.5);
    expect(Number(m.sale_conversion)).toBe(0);
    expect(m.proposal_conversion).toBeNull();
  });

  it("fechamento exige valor e data e entra no período certo", async () => {
    const id = await newLead();
    await expect(asAdmin((c) => c.query(`select public.admin_change_stage($1, 'fechado')`, [id]))).rejects.toThrow();
    await asAdmin(async (c) => {
      await c.query(`select public.admin_mark_contacted($1, '2026-10-01 10:00-03'::timestamptz)`, [id]);
      await c.query(`select public.admin_register_proposal($1, 1500, '2026-10-02 10:00-03'::timestamptz)`, [id]);
      await c.query(`select public.admin_register_closing($1, 1200.50, '2026-10-07 16:00-03'::timestamptz)`, [id]);
    });
    const m = await metrics("2026-10-01", "2026-10-31");
    expect(m).toMatchObject({ closed_sales: 1, proposals_sent: 1 });
    expect(Number(m.closed_value)).toBe(1200.5);
    expect(Number(m.sale_conversion)).toBe(1);
    expect(Number(m.proposal_conversion)).toBe(1);
    expect((await metrics("2026-09-01", "2026-09-30")).closed_sales).toBe(0);
  });

  it("delimita os períodos no fuso de São Paulo", async () => {
    const id = await newLead();
    // 23:30 em São Paulo = 02:30 UTC do dia seguinte.
    await asAdmin((c) => c.query(`select public.admin_mark_contacted($1, '2026-10-08 23:30-03'::timestamptz)`, [id]));
    expect((await metrics("2026-10-08", "2026-10-08")).contact_actions).toBe(1);
    expect((await metrics("2026-10-09", "2026-10-09")).contact_actions).toBe(0);
  });

  it("taxas sem denominador voltam vazias", async () => {
    const m = await metrics("2026-10-01", "2026-10-01");
    expect(m.response_rate).toBeNull();
    expect(m.sale_conversion).toBeNull();
    expect(m.proposal_conversion).toBeNull();
  });

  it("conta duplicados bloqueados", async () => {
    await newLead();
    await register(tok, candidate());
    await register(tok, candidate({ business_name: "Studio X", instagram: "@studio.x" }));
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    expect((await metrics(today, today)).duplicates_blocked).toBe(2);
  });
});

describe("importação", () => {
  const rows = [
    { business_name: "Clínica Aurora", city: "Bauru", phone: "14 99700-1234", contacted: "sim" },
    { business_name: "Dra. Paula Estética", city: "Marília", phone: "(14) 3433-0000", instagram: "@drapaula", contacted: "nao" },
    {
      business_name: "Bella Face",
      city: "Fernandópolis",
      phone: "17 99100-2222",
      contacted: "sim",
      notes: "Profissional não atua mais no nicho",
      disqualify_reason: "não atua mais no nicho",
    },
    { business_name: "", city: "Bauru", phone: "14 99700-9999" },
  ];

  it("prévia não grava e confirmação grava com contato sem data", async () => {
    const preview = await asAdmin((c) => rpc(c, `select public.admin_import_rows($1::jsonb, true)`, [JSON.stringify(rows)]));
    expect(preview.counts).toMatchObject({ criado: 3, invalido: 1 });
    expect(await count("leads")).toBe(0);

    const done = await asAdmin((c) => rpc(c, `select public.admin_import_rows($1::jsonb, false)`, [JSON.stringify(rows)]));
    expect(done.counts).toMatchObject({ criado: 3, invalido: 1, existente: 0 });
    const { rows: leads } = await pool.query(
      `select business_name, contacted, contact_date_unknown, first_contact_at, stage, loss_reason, phone_raw, origin
       from leads order by business_name`,
    );
    expect(leads).toEqual([
      expect.objectContaining({ business_name: "Bella Face", contacted: true, stage: "desqualificado", loss_reason: "não atua mais no nicho" }),
      expect.objectContaining({ business_name: "Clínica Aurora", contacted: true, contact_date_unknown: true, first_contact_at: null, stage: "contatado", phone_raw: "14 99700-1234", origin: "importacao" }),
      expect.objectContaining({ business_name: "Dra. Paula Estética", contacted: false, stage: "novo" }),
    ]);
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    const m = await metrics(today, today);
    expect(m).toMatchObject({ contact_actions: 0, contacted_leads: 0, contacted_total: 2, contacted_undated: 2 });
  });

  it("importar o mesmo arquivo de novo não duplica fichas nem contatos", async () => {
    await asAdmin((c) => c.query(`select public.admin_import_rows($1::jsonb, false)`, [JSON.stringify(rows)]));
    const again = await asAdmin((c) => rpc(c, `select public.admin_import_rows($1::jsonb, false)`, [JSON.stringify(rows)]));
    expect(again.counts).toMatchObject({ criado: 0, existente: 3, invalido: 1 });
    expect(await count("leads")).toBe(3);
    expect(await count("contact_events")).toBe(2);
    expect(await count("lead_notes")).toBe(1);
  });
});

describe("segurança e permissões", () => {
  it("visitante sem login não lê nem escreve nada", async () => {
    await newLead();
    await expect(as("anon", null, (c) => c.query(`select * from leads`))).rejects.toThrow(/permission denied/);
    await expect(
      as("anon", null, (c) => c.query(`select public.admin_create_lead('{}'::jsonb)`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as("anon", null, (c) => c.query(`select public.api_register_candidate(null, 'x', '{}'::jsonb, null)`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("usuário autenticado que não é admin não enxerga leads nem executa ações", async () => {
    await newLead();
    const r = await as("authenticated", OUTSIDER_ID, (c) => c.query(`select * from leads`));
    expect(r.rowCount).toBe(0);
    await expect(
      as("authenticated", OUTSIDER_ID, (c) => c.query(`select public.dashboard_metrics('2026-10-01', '2026-10-02')`)),
    ).rejects.toThrow(/acesso negado/);
    const admin = await as("authenticated", ADMIN_ID, (c) => c.query(`select * from leads`));
    expect(admin.rowCount).toBe(1);
  });

  it("navegador não lê tokens nem chaves de idempotência", async () => {
    await expect(asAdmin((c) => c.query(`select * from integration_tokens`))).rejects.toThrow(/permission denied/);
    await expect(asAdmin((c) => c.query(`select * from idempotency_keys`))).rejects.toThrow(/permission denied/);
    const pub = await asAdmin((c) => c.query(`select * from integration_tokens_public`));
    expect(pub.rows[0]).not.toHaveProperty("token_hash");
    expect(await count("integration_tokens", `token_hash = '${sha256(tokenPlain)}'`)).toBe(1);
    expect(await count("integration_tokens", `token_hash = '${tokenPlain}'`)).toBe(0);
  });

  it("autenticado não chama funções do Hermes", async () => {
    await expect(
      asAdmin((c) => c.query(`select public.api_start_run($1, 'prospeccao-diaria', '{}'::jsonb)`, [tok])),
    ).rejects.toThrow(/permission denied/);
  });

  it("token do Hermes não tem escopo comercial e revogação bloqueia", async () => {
    expect(await tokenId(tokenPlain, "leads:alterar_etapa")).toBeNull();
    expect(await tokenId(tokenPlain, "candidatos:criar")).toBe(tok);
    const id = await newLead();
    await expect(
      asService((c) => c.query(`select public.admin_change_stage($1, 'fechado')`, [id])),
    ).rejects.toThrow();
    await asAdmin((c) => c.query(`select public.admin_revoke_integration_token($1)`, [tok]));
    expect(await tokenId(tokenPlain)).toBeNull();
  });
});

describe("execuções do Hermes", () => {
  it("impede duas execuções simultâneas e contabiliza resultados", async () => {
    const start = (t: string) =>
      asService((c) => rpc(c, `select public.api_start_run($1, 'prospeccao-diaria', '{"meta":20}'::jsonb)`, [t]));
    const [a, b] = await Promise.all([start(tok), start(tok)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["iniciada", "ja_em_andamento"]);
    const run = (a.status === "iniciada" ? a : b).run_id;

    await register(tok, candidate(), undefined, run);
    await register(tok, candidate(), undefined, run);
    await register(tok, candidate({ phone: "1" }), undefined, run);

    const fin = await asService((c) =>
      rpc(c, `select public.api_finish_run($1, $2, $3::jsonb)`, [
        tok,
        run,
        JSON.stringify({ status: "parcial", searched: 12, approved: 3, discarded: 9, errors: 0, end_reason: "só 1 candidato novo adequado" }),
      ]),
    );
    expect(fin.status).toBe("encerrada");
    const { rows } = await pool.query(`select * from hermes_runs where id = $1`, [run]);
    expect(rows[0]).toMatchObject({ status: "parcial", created: 1, existing: 1, invalid: 1, searched: 12 });
    expect((await start(tok)).status).toBe("iniciada");
  });

  it("execução esquecida aberta é encerrada como abandonada", async () => {
    await pool.query(
      `insert into hermes_runs (routine, token_id, started_at) values ('prospeccao-diaria', $1, now() - interval '3 hours')`,
      [tok],
    );
    const r = await asService((c) => rpc(c, `select public.api_start_run($1, 'prospeccao-diaria', '{}'::jsonb)`, [tok]));
    expect(r.status).toBe("iniciada");
    expect(await count("hermes_runs", "status = 'abandonada'")).toBe(1);
  });

  it("não aceita candidatos em execução encerrada", async () => {
    const r = await asService((c) => rpc(c, `select public.api_start_run($1, 'prospeccao-diaria', '{}'::jsonb)`, [tok]));
    await asService((c) =>
      c.query(`select public.api_finish_run($1, $2, '{"status":"concluida","end_reason":"fim"}'::jsonb)`, [tok, r.run_id]),
    );
    const res = await register(tok, candidate(), undefined, r.run_id);
    expect(res.status).toBe("invalido");
  });
});

describe("importação preserva telefone como texto", () => {
  it("telefone sem DDD entra como texto original e sem normalização", async () => {
    await resetData();
    const r = await asAdmin((c) =>
      rpc(c, `select public.admin_import_rows($1::jsonb, false)`, [
        JSON.stringify([{ business_name: "Studio Rosa", city: "Bauru", phone: "99123-4567" }]),
      ]),
    );
    expect(r.counts.criado).toBe(1);
    const { rows } = await pool.query(`select phone_raw, phone_e164 from leads`);
    expect(rows[0]).toEqual({ phone_raw: "99123-4567", phone_e164: null });
  });
});

describe("limites do servidor para o Hermes", () => {
  it("respeita a meta diária mesmo que o agente insista", async () => {
    await resetData();
    const t = await createToken();
    const tk = (await tokenId(t.token))!;
    await pool.query(`update prospecting_settings set daily_target = 2`);
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(
        await register(tk, candidate({ business_name: ["Aurora", "Lumière", "Jasmim", "Safira"][i], phone: `(17) 9900${i}-000${i}`, instagram: `@teste.unico.${i}` })),
      );
    }
    expect(results.map((r) => r.status)).toEqual(["criado", "criado", "limite_atingido", "limite_atingido"]);
    expect(await count("leads")).toBe(2);
  });

  it("recusa cadastros depois do tempo máximo da execução", async () => {
    await resetData();
    const t = await createToken();
    const tk = (await tokenId(t.token))!;
    const r = await asService((c) => rpc(c, `select public.api_start_run($1, 'prospeccao-diaria', '{}'::jsonb)`, [tk]));
    await pool.query(`update hermes_runs set started_at = now() - interval '50 minutes' where id = $1`, [r.run_id]);
    const res = await register(tk, candidate(), undefined, r.run_id);
    expect(res.status).toBe("limite_atingido");
    expect(await count("leads")).toBe(0);
  });
});
