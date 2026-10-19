import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, candidate, createToken, pool, register, resetData, rpc } from "./helpers";

describe("OBS da pesquisa até a seleção do disparo", () => {
  beforeEach(resetData);

  it("mantém pendente fora da fila e só aceita após evidência revisada", async () => {
    const token = await createToken();
    const run = (await pool.query("insert into hermes_runs(routine,token_id) values('prospeccao-diaria',$1) returning id", [token.id])).rows[0].id as string;
    await pool.query("insert into hermes_requests(qualified_target,max_searches,max_minutes,status,run_id,observations) values(1,10,5,'em_andamento',$1,'Bio sem página de links ou só WhatsApp')", [run]);
    const result = await register(token.id, candidate(), undefined, run);
    const lead = result.lead_id as string;
    const verdict = await pool.query("select verdict from research_run_leads where run_id=$1 and lead_id=$2", [run, lead]);
    expect(verdict.rows[0].verdict).toBe("pendente");
    const availableBefore = await pool.query("select 1 from dispatch_available_ids() where dispatch_available_ids=$1", [lead]);
    expect(availableBefore.rowCount).toBe(0);

    const camp = await asAdmin(c => rpc<string>(c, "select admin_campaign_create($1,$2)", ["Teste OBS", "notas"]));
    const rejected = await asAdmin(c => rpc<{ added: number; rejected_total: number }>(c, "select admin_campaign_add_leads($1,$2::uuid[])", [camp, [lead]]));
    expect(rejected.added).toBe(0);
    expect(rejected.rejected_total).toBe(1);

    await asAdmin(c => c.query("select admin_review_research_lead($1,$2,'confirmado',$3)", [run, lead, "Bio expandida sem link de página; destino conferido manualmente."]));
    const availableAfter = await pool.query("select 1 from dispatch_available_ids() where dispatch_available_ids=$1", [lead]);
    expect(availableAfter.rowCount).toBe(1);
    const approved = await asAdmin(c => rpc<{ added: number }>(c, "select admin_campaign_add_leads($1,$2::uuid[])", [camp, [lead]]));
    expect(approved.added).toBe(1);
  });
});
