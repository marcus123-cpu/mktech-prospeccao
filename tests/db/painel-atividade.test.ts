import { beforeEach, describe, expect, it } from "vitest";
import { as, asAdmin, candidate, createToken, OUTSIDER_ID, pool, register, resetData, rpc, tokenId } from "./helpers";

describe("contagens operacionais do painel", () => {
  beforeEach(resetData);

  it("conta todos os eventos do dia, inclusive depois do antigo limite de 2.000 linhas", async () => {
    const writer = (await tokenId((await createToken()).token))!;
    const created = await register(writer, candidate());
    const lead = created.lead_id as string;
    await pool.query(`insert into outreach_messages
      (lead_id, status, compliment, pain, improvement, body, greeting_sent_at, sent_at)
      values ($1, 'enviada', 'elogio', 'dor', 'melhoria', 'mensagem', now(), now())`, [lead]);
    await pool.query(`insert into outreach_replies (lead_id, phone_e164, body, received_at, kind, opt_out)
      select $1, '+5517991234567', 'resposta ' || n, now() - n * interval '1 second', 'humana', n = 1
      from generate_series(1, 2105) n`, [lead]);
    await pool.query(`insert into outreach_replies (lead_id, phone_e164, body, received_at, kind)
      values ($1, '+5517991234567', 'resposta automática', now(), 'automatica')`, [lead]);

    const data = await asAdmin((c) => rpc<any>(c, `select public.dashboard_activity()`));
    expect(data.sent_today).toBe(1);
    expect(data.texts_today).toBe(1);
    expect(data.human_today).toBe(2105);
    expect(data.optouts_today).toBe(1);
    expect(data.ready_count).toBe(0);
    expect(data.days).toHaveLength(7);
    expect(data.days[6].respostas).toBe(2105);
    expect(data.days[6].saudacoes).toBe(1);
  });

  it("só o administrador pode consultar os indicadores", async () => {
    await expect(as("authenticated", OUTSIDER_ID, (c) => rpc(c, `select public.dashboard_activity()`))).rejects.toThrow();
  });
});
