import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, as, OUTSIDER_ID, candidate, count, createToken, pool, register, resetData, tokenId } from "./helpers";

const diagnosis = {
  fit_score: 82,
  confidence: "media",
  summary: "Clínica de estética facial ativa, agenda só pelo WhatsApp.",
  audience: "Mulheres 30-50 em Votuporanga",
  digital_presence: "Instagram ativo, 4,8 no Google com 17 avaliações, sem site.",
  pains: [{ pain: "Agenda manual pelo WhatsApp", evidence: "Bio: 'agende pelo direct ou WhatsApp'" }],
  opportunities: ["Página com agendamento online"],
  offer: "site_com_agendamento",
  offer_reason: "Muitas mensagens para marcar horário; agendamento online libera tempo.",
  approach: "Elogiar as avaliações e mostrar exemplo de página com agenda.",
  objections: ["Já tenho Instagram"],
};

describe("diagnóstico do lead", () => {
  let tok: string;
  beforeEach(async () => {
    await resetData();
    tok = (await tokenId((await createToken()).token))!;
  });

  it("grava o diagnóstico junto do cadastro e atualiza nota e oferta da ficha", async () => {
    const r = await register(tok, candidate({ diagnosis }));
    expect(r.status).toBe("criado");
    const lead = (await pool.query(`select fit_score, recommended_offer from leads where id = $1`, [r.lead_id])).rows[0];
    expect(lead).toEqual({ fit_score: 82, recommended_offer: "site_com_agendamento" });
    const d = (await pool.query(`select * from lead_diagnoses where lead_id = $1`, [r.lead_id])).rows[0];
    expect(d.pains[0].pain).toBe("Agenda manual pelo WhatsApp");
    expect(d.objections).toEqual(["Já tenho Instagram"]);
  });

  it("nova pesquisa do mesmo lead cria outra versão sem apagar a anterior", async () => {
    const r1 = await register(tok, candidate({ diagnosis }));
    const r2 = await register(tok, candidate({ diagnosis: { ...diagnosis, fit_score: 60, offer: "landing_page" } }));
    expect(r2).toMatchObject({ status: "existente", lead_id: r1.lead_id });
    expect(await count("lead_diagnoses", `lead_id = '${r1.lead_id}'`)).toBe(2);
    const lead = (await pool.query(`select fit_score, recommended_offer, stage from leads where id = $1`, [r1.lead_id])).rows[0];
    expect(lead).toMatchObject({ fit_score: 60, recommended_offer: "landing_page", stage: "novo" });
  });

  it("cadastro sem diagnóstico continua funcionando", async () => {
    const r = await register(tok, candidate());
    expect(r.status).toBe("criado");
    expect(await count("lead_diagnoses")).toBe(0);
  });

  it("diagnóstico inválido não derruba o cadastro", async () => {
    const r = await register(tok, candidate({ diagnosis: { ...diagnosis, fit_score: 500, offer: "qualquer" } }));
    expect(r.status).toBe("criado");
    expect(await count("lead_diagnoses")).toBe(0);
  });

  it("diagnóstico de candidato na fila de revisão entra quando o admin cria o lead", async () => {
    await register(tok, candidate());
    const r = await register(
      tok,
      candidate({ phone: "(17) 98888-0000", instagram: "@outra.bella", diagnosis, business_name: "Clinica Bella Pelle Estetica" }),
    );
    expect(r.status).toBe("possivel_duplicado");
    const res = await asAdmin(async (c) =>
      (await c.query(`select public.admin_resolve_review($1, 'criar_novo') as r`, [r.review_id])).rows[0].r,
    );
    expect(await count("lead_diagnoses", `lead_id = '${res.lead_id}'`)).toBe(1);
  });

  it("só admin lê diagnósticos", async () => {
    await register(tok, candidate({ diagnosis }));
    expect((await asAdmin((c) => c.query(`select * from lead_diagnoses`))).rowCount).toBe(1);
    expect((await as("authenticated", OUTSIDER_ID, (c) => c.query(`select * from lead_diagnoses`))).rowCount).toBe(0);
    await expect(as("anon", null, (c) => c.query(`select * from lead_diagnoses`))).rejects.toThrow();
  });
});
