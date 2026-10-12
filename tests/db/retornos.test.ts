import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, candidate, createToken, pool, register, resetData } from "./helpers";

describe("retornos manuais", () => {
  beforeEach(resetData);

  it("agendar mostra o lead na lista e remover limpa a lista", async () => {
    const token = (await createToken()).id;
    const created = await register(token, candidate());
    const lead = created.lead_id as string;
    const when = new Date(Date.now() + 86_400_000).toISOString();

    await asAdmin((c) => c.query(`select public.admin_schedule_follow_up($1, $2)`, [lead, when]));
    const scheduled = await asAdmin((c) => c.query(`select id, next_follow_up_at from public.leads
      where next_follow_up_at is not null and stage not in ('fechado', 'sem_interesse', 'desqualificado')
      order by next_follow_up_at limit 500`));
    expect(scheduled.rows).toHaveLength(1);
    expect(scheduled.rows[0].id).toBe(lead);
    expect(scheduled.rows[0].next_follow_up_at.toISOString()).toBe(when);

    await asAdmin((c) => c.query(`select public.admin_schedule_follow_up($1, null)`, [lead]));
    const after = await pool.query(`select count(*)::int as total from public.leads where next_follow_up_at is not null`);
    expect(after.rows[0].total).toBe(0);
  });
});
