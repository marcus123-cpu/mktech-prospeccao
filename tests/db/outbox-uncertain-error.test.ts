import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asService, candidate, createToken, pool, register, resetData, rpc } from "./helpers";

describe("resultado incerto do WhatsApp", () => {
  beforeEach(resetData);

  it("mantém o erro original quando o journal repete desconhecido sem detalhe", async () => {
    const token = await createToken();
    const lead = (await register(token.id, candidate())).lead_id as string;
    const id = (await pool.query("insert into commercial_outbox(lead_id,idempotency_key,kind,body,phone_e164,status,claimed_at) values($1,$2,'initial','Olá! Tudo bem?','+5517991234567','enviando',now()) returning id", [lead, randomUUID()])).rows[0].id as string;
    await asService(c => rpc(c, "select api_commercial_result($1,$2,'desconhecido',null,$3)", [token.id, id, "ponte: timeout depois da reserva"]));
    await asService(c => rpc(c, "select api_commercial_result($1,$2,'desconhecido',null,null)", [token.id, id]));
    const row = (await pool.query("select status,error,sent_at from commercial_outbox where id=$1", [id])).rows[0];
    expect(row).toMatchObject({ status: "desconhecido", error: "ponte: timeout depois da reserva", sent_at: null });
  });
});
