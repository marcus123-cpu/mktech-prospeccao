import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asService, candidate, count, createToken, pool, register, resetData, rpc, tokenId } from "./helpers";

let tok: string;

beforeEach(async () => {
  await resetData();
  const t = await createToken();
  tok = (await tokenId(t.token))!;
});

afterAll(async () => {
  await pool.end();
});

describe("controle de duplicados", () => {
  it("reconhece o mesmo telefone em formatos diferentes", async () => {
    const a = await register(tok, candidate({ instagram: null }));
    expect(a.status).toBe("criado");
    for (const phone of ["17991234567", "+55 (17) 99123-4567", "017 17 99123 4567", "(17) 9123-4567"]) {
      const b = await register(tok, candidate({ instagram: null, phone }));
      expect(b).toMatchObject({ status: "existente", lead_id: a.lead_id, matched_on: "telefone" });
    }
    expect(await count("leads")).toBe(1);
  });

  it("reconhece o mesmo Instagram em formatos diferentes", async () => {
    const a = await register(tok, candidate({ phone: null }));
    for (const instagram of [
      "bellapelle.estetica",
      "https://www.instagram.com/BellaPelle.Estetica/?hl=pt-br",
      "instagram.com/bellapelle.estetica/",
      "@@BELLAPELLE.ESTETICA",
    ]) {
      const b = await register(tok, candidate({ phone: null, instagram }));
      expect(b).toMatchObject({ status: "existente", lead_id: a.lead_id, matched_on: "instagram" });
    }
    expect(await count("leads")).toBe(1);
  });

  it("nome parecido de negócios distintos vai para revisão, sem mesclar", async () => {
    await register(tok, candidate());
    const b = await register(
      tok,
      candidate({ business_name: "Clínica Bela Pele", phone: "(17) 99777-0000", instagram: "@belapele.vtp" }),
    );
    expect(b.status).toBe("possivel_duplicado");
    expect(b.reason).toBe("nome_parecido");
    expect(await count("leads")).toBe(1);
    expect(await count("duplicate_reviews", "status = 'pendente'")).toBe(1);
  });

  it("nome igual em outra cidade é outro negócio", async () => {
    await register(tok, candidate());
    const b = await register(tok, candidate({ city: "Bauru", phone: "(14) 99777-0000", instagram: "@bellapelle.bauru" }));
    expect(b.status).toBe("criado");
  });

  it("telefone compartilhado por empresas distintas gera revisão", async () => {
    await register(tok, candidate());
    const b = await register(
      tok,
      candidate({ business_name: "Studio Sobrancelhas Ana", instagram: "@studio.ana.sobrancelhas" }),
    );
    expect(b).toMatchObject({ status: "possivel_duplicado", reason: "telefone_compartilhado" });
    expect(await count("leads")).toBe(1);
  });

  it("mesma requisição repetida é idempotente", async () => {
    const key = randomUUID();
    const a = await register(tok, candidate(), key);
    const b = await register(tok, candidate(), key);
    expect(b).toMatchObject({ status: "criado", lead_id: a.lead_id, replayed: true });
    expect(await count("leads")).toBe(1);
    expect(await count("lead_evidences")).toBe(1);
    const c = await register(tok, candidate({ business_name: "Outra" }), key);
    expect(c.status).toBe("invalido");
  });

  it("duas criações simultâneas do mesmo negócio geram uma única ficha", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        register(tok, candidate({ phone: i % 2 ? "17991234567" : "(17) 99123-4567" })),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === "criado")).toHaveLength(1);
    expect(statuses.filter((s) => s === "existente")).toHaveLength(7);
    expect(await count("leads")).toBe(1);
  });

  it("requisições simultâneas com a mesma chave também não duplicam", async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => register(tok, candidate(), key)));
    expect(new Set(results.map((r) => r.lead_id)).size).toBe(1);
    expect(await count("leads")).toBe(1);
  });

  it("lead desqualificado continua bloqueando novo cadastro", async () => {
    const a = await register(tok, candidate());
    await asAdmin((c) => c.query(`select public.admin_change_stage($1, 'desqualificado', null, 'não atua mais no nicho')`, [a.lead_id]));
    const b = await register(tok, candidate({ instagram: null }));
    expect(b).toMatchObject({ status: "existente", lead_id: a.lead_id });
    const { rows } = await pool.query(`select stage from leads where id = $1`, [a.lead_id]);
    expect(rows[0].stage).toBe("desqualificado");
  });

  it("novas evidências preservam etapa, contatos e observações", async () => {
    const a = await register(tok, candidate({ site_status: "verificacao_pendente" }));
    await asAdmin(async (c) => {
      await c.query(`select public.admin_mark_contacted($1)`, [a.lead_id]);
      await c.query(`select public.admin_change_stage($1, 'interessado')`, [a.lead_id]);
      await c.query(`select public.admin_add_note($1, 'Pediu retorno na sexta')`, [a.lead_id]);
    });
    const b = await register(
      tok,
      candidate({
        site_status: "apenas_redes_sociais",
        neighborhood: "Centro",
        priority: "baixa",
        evidences: [{ kind: "busca", summary: "Só encontrei Instagram e linktree.", url: "https://linktr.ee/bella" }],
      }),
    );
    expect(b.status).toBe("existente");
    const { rows } = await pool.query(`select * from leads where id = $1`, [a.lead_id]);
    expect(rows[0]).toMatchObject({
      stage: "interessado",
      contacted: true,
      priority: "alta",
      neighborhood: "Centro",
      site_status: "apenas_redes_sociais",
    });
    expect(await count("lead_notes")).toBe(1);
    expect(await count("lead_evidences")).toBe(2);
  });

  it("unidades diferentes da mesma clínica ficam distinguíveis", async () => {
    await register(tok, candidate({ unit_label: "Centro" }));
    const b = await register(tok, candidate({ unit_label: "Shopping", phone: "(17) 99555-1111" }));
    expect(b).toMatchObject({ status: "possivel_duplicado", reason: "instagram_outra_unidade" });
    const res = await asAdmin((c) =>
      rpc(c, `select public.admin_resolve_review($1, 'criar_novo', null, '{}'::jsonb, 'segunda unidade')`, [b.review_id]),
    );
    expect(res.status).toBe("resolvida");
    expect(await count("leads")).toBe(2);
    const again = await register(tok, candidate({ unit_label: "Shopping", phone: "(17) 99555-1111" }));
    expect(again.status).toBe("existente");
  });

  it("identificador da fonte reconhece a mesma ficha", async () => {
    const a = await register(tok, candidate({ source_name: "google_maps", source_place_id: "ChIJ123" }));
    const b = await register(
      tok,
      candidate({ source_name: "google_maps", source_place_id: "ChIJ123", phone: null, instagram: "@outro.perfil" }),
    );
    expect(b.status).toBe("possivel_duplicado");
    const c = await register(
      tok,
      candidate({ source_name: "google_maps", source_place_id: "ChIJ123", phone: "(17) 3421-0000", instagram: null }),
    );
    expect(c).toMatchObject({ status: "existente", lead_id: a.lead_id, matched_on: "fonte" });
  });

  it("dados inválidos são recusados com motivo", async () => {
    const r = await register(tok, candidate({ phone: "1234", instagram: "https://instagram.com/p/xyz", evidences: [] }));
    expect(r.status).toBe("invalido");
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
    expect(await count("leads")).toBe(0);
  });

  it("revisão repetida do mesmo candidato não multiplica a fila", async () => {
    await register(tok, candidate());
    const other = candidate({ business_name: "Studio Ana", instagram: "@studio.ana" });
    await register(tok, other);
    await register(tok, other);
    expect(await count("duplicate_reviews")).toBe(1);
    expect(await count("dedupe_events", "outcome = 'revisao'")).toBe(2);
  });

  it("consulta de duplicados não grava nada nem expõe dados comerciais", async () => {
    const a = await register(tok, candidate());
    const check = await asService((c) =>
      rpc(c, `select public.api_check_duplicates($1, $2::jsonb)`, [tok, JSON.stringify(candidate({ instagram: null }))]),
    );
    expect(check.status).toBe("existente");
    expect(check.matches[0]).toEqual({ id: a.lead_id, business_name: "Clínica Bella Pelle", city: "Votuporanga", unit: null });
    expect(await count("dedupe_events")).toBe(0);
  });
});
